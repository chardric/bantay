//go:build linux

package agent

import (
	"bufio"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"bantay/agent/utils"
	"bantay/internal/entities/system"
)

// DRM fdinfo is the kernel-blessed cross-vendor GPU utilization scheme.
// Each open DRM client (every process using a GPU) gets a /proc/<pid>/fdinfo/<n>
// file with a "drm-engine-<name>: <ns> ns" line per HW engine, accumulated since
// fd open. Sum across all clients per pdev, diff over an interval -> busy %.
//
// Driver support:
//   amdgpu  >= 5.14   (gfx, compute, dma, enc, dec)
//   i915    >= 5.19   (rcs, bcs, vcs, vecs)
//   xe      >= 6.8    (rcs, bcs, vcs, vecs, ccs)
//   v3d     >= 6.6    (bin, render, tfu, csd, cache-clean)
//   panfrost>= 6.6    (fragment, vertex-tiler)
//   msm     >= 6.0
//
// Drivers that do NOT support fdinfo (no signal possible from this collector):
//   radeon (pre-GCN AMD), lima (Mali-400/450), nvidia proprietary

const (
	fdinfoPollInterval = 3 * time.Second
)

type fdinfoSnapshot struct {
	// pdev -> engine -> total cumulative ns across all clients
	cards     map[string]map[string]uint64
	timestamp time.Time
}

// hasDrmFdinfo returns true if any DRM card exists on the system. The fdinfo
// collector itself will produce data only when clients appear; we don't gate on
// active clients at startup, since an idle GPU has no fdinfo entries at all.
func (gm *GPUManager) hasDrmFdinfo() bool {
	matches, err := filepath.Glob("/sys/class/drm/card[0-9]*")
	if err != nil {
		return false
	}
	for _, m := range matches {
		// skip connector entries like card0-DP-1
		if !strings.Contains(filepath.Base(m), "-") {
			return true
		}
	}
	return false
}

// collectDrmFdinfoStats polls /proc fdinfo across all DRM clients and writes
// per-pdev usage into GpuDataMap. Runs forever — it's normal for an idle host
// to have no DRM clients (then transcoding starts and clients appear). We log
// once on transition rather than spamming every poll.
func (gm *GPUManager) collectDrmFdinfoStats() error {
	var prev *fdinfoSnapshot
	hadClients := false
	for {
		cur := gm.gatherFdinfoSnapshot()
		if len(cur.cards) == 0 {
			if hadClients {
				slog.Debug("DRM clients went idle; waiting")
				hadClients = false
			}
			prev = nil // force baseline rebuild on next sample
			time.Sleep(fdinfoPollInterval)
			continue
		}
		if !hadClients {
			slog.Debug("DRM clients detected; reporting GPU usage", "cards", len(cur.cards))
			hadClients = true
		}

		// First sample establishes a baseline; we need two snapshots to compute deltas.
		if prev != nil {
			gm.applyFdinfoDelta(prev, cur)
		}
		prev = cur
		time.Sleep(fdinfoPollInterval)
	}
}

// gatherFdinfoSnapshot scans every /proc/<pid>/fdinfo/<fd> file once and
// aggregates engine ns counters per pdev (across all processes/clients).
func (gm *GPUManager) gatherFdinfoSnapshot() *fdinfoSnapshot {
	snap := &fdinfoSnapshot{
		cards:     make(map[string]map[string]uint64),
		timestamp: time.Now(),
	}
	matches, err := filepath.Glob("/proc/[0-9]*/fdinfo/[0-9]*")
	if err != nil {
		return snap
	}
	for _, p := range matches {
		pdev, _, engines := parseDrmFdinfo(p)
		if pdev == "" || len(engines) == 0 {
			continue
		}
		dst, ok := snap.cards[pdev]
		if !ok {
			dst = make(map[string]uint64)
			snap.cards[pdev] = dst
		}
		for engine, ns := range engines {
			dst[engine] += ns
		}
	}
	return snap
}

// parseDrmFdinfo reads a single fdinfo file and extracts drm-driver, drm-pdev,
// and drm-engine-<name> values. Returns ("", "", nil) if not a DRM fd.
func parseDrmFdinfo(path string) (pdev, driver string, engines map[string]uint64) {
	f, err := os.Open(path)
	if err != nil {
		return "", "", nil
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 4096), 64*1024)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "drm-") {
			continue
		}
		colon := strings.IndexByte(line, ':')
		if colon < 0 {
			continue
		}
		key := line[:colon]
		val := strings.TrimSpace(line[colon+1:])
		switch {
		case key == "drm-driver":
			driver = val
		case key == "drm-pdev":
			pdev = val
		case strings.HasPrefix(key, "drm-engine-") && !strings.HasPrefix(key, "drm-engine-capacity-"):
			if engines == nil {
				engines = make(map[string]uint64)
			}
			engineName := strings.TrimPrefix(key, "drm-engine-")
			engines[engineName] += parseFdinfoNs(val)
		}
	}
	return pdev, driver, engines
}

// parseFdinfoNs parses values like "1234567 ns" returning the integer part.
func parseFdinfoNs(s string) uint64 {
	s = strings.TrimSpace(s)
	if i := strings.IndexByte(s, ' '); i > 0 {
		s = s[:i]
	}
	n, _ := strconv.ParseUint(s, 10, 64)
	return n
}

// applyFdinfoDelta computes per-engine busy % for each card between two
// snapshots and stores the maximum engine % as that GPU's overall usage
// (matching how nvtop and gnome-system-monitor present it).
func (gm *GPUManager) applyFdinfoDelta(prev, cur *fdinfoSnapshot) {
	intervalNs := uint64(cur.timestamp.Sub(prev.timestamp).Nanoseconds())
	if intervalNs == 0 {
		return
	}

	gm.Lock()
	defer gm.Unlock()
	for pdev, curEngines := range cur.cards {
		prevEngines, ok := prev.cards[pdev]
		if !ok {
			continue
		}
		var maxBusyPct float64
		for engine, curNs := range curEngines {
			prevNs := prevEngines[engine]
			if curNs <= prevNs {
				continue
			}
			pct := float64(curNs-prevNs) * 100.0 / float64(intervalNs)
			if pct > maxBusyPct {
				maxBusyPct = pct
			}
		}
		// Cap at 100 — multi-engine concurrency or sampling jitter can briefly exceed.
		if maxBusyPct > 100 {
			maxBusyPct = 100
		}

		gpu, ok := gm.GpuDataMap[pdev]
		if !ok {
			gpu = &system.GPUData{Name: getDrmGpuName(pdev)}
			gm.GpuDataMap[pdev] = gpu
		}
		gpu.Usage += maxBusyPct
		gpu.Count++

		// Try to read temperature from any matching hwmon node.
		if t := readDrmCardTemp(pdev); t > 0 {
			gpu.Temperature = t
		}
	}
}

// getDrmGpuName resolves a friendly label for a pdev like "0000:03:00.0".
// Walks /sys/class/drm to find the matching card and reads vendor/device.
func getDrmGpuName(pdev string) string {
	cards, _ := filepath.Glob("/sys/class/drm/card[0-9]*")
	for _, card := range cards {
		if strings.Contains(filepath.Base(card), "-") {
			continue
		}
		// Resolve symlink: /sys/class/drm/card0/device -> /sys/devices/pci.../<pdev>
		dev, err := os.Readlink(filepath.Join(card, "device"))
		if err != nil {
			continue
		}
		if !strings.HasSuffix(dev, "/"+pdev) && filepath.Base(dev) != pdev {
			continue
		}
		vendor, _ := utils.ReadStringFileLimited(filepath.Join(card, "device/vendor"), 64)
		device, _ := utils.ReadStringFileLimited(filepath.Join(card, "device/device"), 64)
		return fmt.Sprintf("%s GPU (%s)", vendorLabel(vendor), normalizeHexID(device))
	}
	return fmt.Sprintf("GPU (%s)", pdev)
}

// vendorLabel maps the PCI vendor ID (hex string) to a human label.
func vendorLabel(vendor string) string {
	switch vendor {
	case "0x8086":
		return "Intel"
	case "0x1002":
		return "AMD"
	case "0x10de":
		return "NVIDIA"
	case "0x14e4":
		return "Broadcom"
	}
	return "Unknown"
}

// readDrmCardTemp returns the first hwmon temp1_input (in °C) for a pdev,
// or 0 if none is found / readable.
func readDrmCardTemp(pdev string) float64 {
	cards, _ := filepath.Glob("/sys/class/drm/card[0-9]*")
	for _, card := range cards {
		if strings.Contains(filepath.Base(card), "-") {
			continue
		}
		dev, err := os.Readlink(filepath.Join(card, "device"))
		if err != nil || (!strings.HasSuffix(dev, "/"+pdev) && filepath.Base(dev) != pdev) {
			continue
		}
		hwmons, _ := filepath.Glob(filepath.Join(card, "device/hwmon/hwmon*"))
		for _, hwmonDir := range hwmons {
			if t, err := readSysfsFloat(filepath.Join(hwmonDir, "temp1_input")); err == nil {
				return t / 1000.0
			}
		}
	}
	return 0
}
