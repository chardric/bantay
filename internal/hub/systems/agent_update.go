package systems

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/blang/semver"

	"bantay"
	"bantay/internal/common"
	"bantay/internal/hub/expirymap"
)

// agentBinary holds an embedded agent payload the hub can push to outdated agents.
type agentBinary struct {
	Arch    string
	Version string
	Sha256  string
	Bytes   []byte
}

// agentUpdater loads agent binaries from disk at startup and serves them by
// architecture tag. Reads are nil-safe so an unconfigured hub (no /agents
// directory in the image) silently disables updates rather than crashing.
type agentUpdater struct {
	disabled    bool
	hubVersion  semver.Version
	binaries    map[string]agentBinary // key: "amd64" | "arm64" | "armv7"
	cooldown    *expirymap.ExpiryMap[time.Time]
	cooldownTtl time.Duration
	pushing     sync.Map // systemID -> *atomic.Bool, set while a push is in flight
}

// agentBinariesDir is where the hub Dockerfile drops the cross-compiled agent
// binaries. Override with BANTAY_AGENT_BINARIES_DIR for testing.
const agentBinariesDir = "/agents"

func newAgentUpdater() *agentUpdater {
	u := &agentUpdater{
		binaries:    map[string]agentBinary{},
		cooldown:    expirymap.New[time.Time](2 * time.Hour),
		cooldownTtl: time.Hour,
	}

	if v := os.Getenv("BANTAY_DISABLE_AUTO_UPDATE"); strings.EqualFold(v, "true") || v == "1" {
		u.disabled = true
		return u
	}

	hubVer, err := semver.Parse(bantay.Version)
	if err != nil {
		slog.Warn("agent updater disabled: bad bantay.Version", "version", bantay.Version, "err", err)
		u.disabled = true
		return u
	}
	u.hubVersion = hubVer

	dir := agentBinariesDir
	if v := os.Getenv("BANTAY_AGENT_BINARIES_DIR"); v != "" {
		dir = v
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		slog.Info("agent updater disabled: no binaries dir", "dir", dir, "err", err)
		u.disabled = true
		return u
	}

	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		const prefix = "agent-"
		if !strings.HasPrefix(name, prefix) {
			continue
		}
		arch := strings.TrimPrefix(name, prefix)
		if !isSupportedArch(arch) {
			continue
		}
		path := filepath.Join(dir, name)
		data, err := os.ReadFile(path)
		if err != nil {
			slog.Warn("agent updater: read failed", "path", path, "err", err)
			continue
		}
		sum := sha256.Sum256(data)
		u.binaries[arch] = agentBinary{
			Arch:    arch,
			Version: bantay.Version,
			Sha256:  hex.EncodeToString(sum[:]),
			Bytes:   data,
		}
		slog.Info("agent updater: loaded binary", "arch", arch, "size", len(data), "sha256_short", hex.EncodeToString(sum[:])[:12])
	}

	if len(u.binaries) == 0 {
		slog.Info("agent updater: no agent binaries found", "dir", dir)
		u.disabled = true
	}
	return u
}

func isSupportedArch(arch string) bool {
	switch arch {
	case "amd64", "arm64", "armv7":
		return true
	}
	return false
}

// normalizeArch maps the heterogeneous arch strings reported by agents
// (host.KernelArch returns "x86_64"/"aarch64"/"armv7l", runtime.GOARCH
// returns "amd64"/"arm64"/"arm") to the hub's binary tags.
func normalizeArch(arch string) string {
	switch strings.ToLower(arch) {
	case "amd64", "x86_64":
		return "amd64"
	case "arm64", "aarch64":
		return "arm64"
	case "arm", "armv7", "armv7l", "armhf":
		return "armv7"
	}
	return ""
}

// shouldAttempt returns the candidate binary and true if this system is
// eligible: updater enabled, agent reports a parseable older version, hub
// has a matching binary, and we're past the per-system cooldown window.
func (u *agentUpdater) shouldAttempt(sys *System) (agentBinary, bool) {
	var zero agentBinary
	if u == nil || u.disabled {
		return zero, false
	}
	if sys == nil || sys.data == nil || sys.data.Info.AgentVersion == "" {
		return zero, false
	}

	agentVer, err := semver.Parse(sys.data.Info.AgentVersion)
	if err != nil || !agentVer.LT(u.hubVersion) {
		return zero, false
	}

	arch := normalizeArch(detailsArch(sys))
	bin, ok := u.binaries[arch]
	if !ok {
		return zero, false
	}

	if last, ok := u.cooldown.GetOk(sys.Id); ok {
		if time.Since(last) < u.cooldownTtl {
			return zero, false
		}
	}
	return bin, true
}

// detailsArch returns the agent-reported arch from system details when present,
// otherwise empty. Auto-update relies on having seen Details at least once;
// pre-Details agents fall through to manual upgrade.
func detailsArch(sys *System) string {
	if sys.data != nil && sys.data.Details != nil {
		return sys.data.Details.Arch
	}
	return ""
}

func (u *agentUpdater) markAttempted(systemID string) {
	if u == nil || u.disabled {
		return
	}
	u.cooldown.Set(systemID, time.Now(), u.cooldownTtl+5*time.Minute)
}

// claim returns true if this is the first push attempt for the system; the
// caller must release() afterward.
func (u *agentUpdater) claim(systemID string) (release func(), ok bool) {
	v, _ := u.pushing.LoadOrStore(systemID, &atomic.Bool{})
	flag := v.(*atomic.Bool)
	if !flag.CompareAndSwap(false, true) {
		return func() {}, false
	}
	return func() { flag.Store(false) }, true
}

// pushUpdate runs in a goroutine: sends the binary, marks the attempt, logs
// the outcome. The agent's handler exits the process after writing the new
// file, so a successful push usually returns a transport error after the ack;
// we treat connection-closed errors as expected when an ack is implied.
func (sys *System) pushUpdate(bin agentBinary) {
	if sys.manager == nil || sys.manager.agentUpdater == nil {
		return
	}
	updater := sys.manager.agentUpdater

	release, claimed := updater.claim(sys.Id)
	if !claimed {
		return
	}
	defer release()

	updater.markAttempted(sys.Id)

	logger := sys.manager.hub.Logger()
	logger.Info("agent update push", "system", sys.Id,
		"arch", bin.Arch, "from", sys.data.Info.AgentVersion, "to", bin.Version, "size", len(bin.Bytes))

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	req := common.PushAgentBinaryRequest{
		Arch:    bin.Arch,
		Version: bin.Version,
		Sha256:  bin.Sha256,
		Binary:  bin.Bytes,
	}
	var ack bool
	err := sys.request(ctx, common.PushAgentBinary, req, &ack)
	if err != nil && !isExpectedDisconnect(err) {
		logger.Warn("agent update push failed", "system", sys.Id, "err", err)
		return
	}
	logger.Info("agent update push acked", "system", sys.Id)
}

func isExpectedDisconnect(err error) bool {
	if errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	s := err.Error()
	return strings.Contains(s, "EOF") ||
		strings.Contains(s, "broken pipe") ||
		strings.Contains(s, "session closed") ||
		strings.Contains(s, "connection reset")
}
