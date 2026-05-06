package agent

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/fxamacker/cbor/v2"

	"bantay/agent/utils"
	"bantay/internal/common"
)

// PushAgentBinaryHandler accepts a replacement agent binary, verifies it,
// atomically swaps it in, then exits so the supervisor relaunches the new one.
//
// Install path resolution (in order):
//  1. Env var BANTAY_AGENT_INSTALL_PATH (set by docker compose to the
//     bind-mounted writable location, e.g. /var/lib/bantay-agent/agent)
//  2. os.Executable() — works for native systemd installs where the
//     supervisor relaunches the same path.
//
// Safety: rejects mismatched arch, verifies sha256, writes via tmp + rename
// for atomicity, keeps previous binary as <install>.bak so a hand-rollback
// is possible. We do NOT auto-rollback on next-launch failure here; that
// would require a separate watchdog. The supervisor restart loop will keep
// trying — if the new binary is broken, the agent stays down and the
// operator can SSH in and `mv .bak` back.
type PushAgentBinaryHandler struct{}

func (h *PushAgentBinaryHandler) Handle(hctx *HandlerContext) error {
	var req common.PushAgentBinaryRequest
	if err := cbor.Unmarshal(hctx.Request.Data, &req); err != nil {
		return fmt.Errorf("decode push binary request: %w", err)
	}

	wantArch := agentArchTag()
	if req.Arch != wantArch {
		return fmt.Errorf("arch mismatch: hub sent %q, agent is %q", req.Arch, wantArch)
	}

	if len(req.Binary) == 0 {
		return errors.New("empty binary payload")
	}

	sum := sha256.Sum256(req.Binary)
	got := hex.EncodeToString(sum[:])
	if got != req.Sha256 {
		return fmt.Errorf("sha256 mismatch: want %s got %s", req.Sha256, got)
	}

	installPath, err := resolveInstallPath()
	if err != nil {
		return fmt.Errorf("resolve install path: %w", err)
	}

	if err := installBinary(installPath, req.Binary); err != nil {
		return fmt.Errorf("install binary: %w", err)
	}

	slog.Info("agent binary updated", "version", req.Version, "path", installPath)

	if err := hctx.SendResponse(true, hctx.RequestID); err != nil {
		return err
	}

	go func() {
		time.Sleep(500 * time.Millisecond)
		os.Exit(0)
	}()

	return nil
}

// agentArchTag normalizes runtime.GOARCH/GOARM into the same tag the hub uses
// when picking which embedded binary to send. Linux only; other GOOS values
// fall through and will mismatch the hub's send (intentional — we don't ship
// non-linux agents from the hub).
func agentArchTag() string {
	switch runtime.GOARCH {
	case "amd64":
		return "amd64"
	case "arm64":
		return "arm64"
	case "arm":
		// GOARM 7 is what we cross-compile for armv7l (orange pi one, rpi 32-bit)
		return "armv7"
	default:
		return runtime.GOARCH
	}
}

// resolveInstallPath returns the path where the new binary should land.
// In docker we want the bind-mounted writable path (BANTAY_AGENT_INSTALL_PATH);
// in native installs we overwrite os.Executable(). Both paths must already
// exist or be creatable in the same directory (atomic rename requires same
// filesystem).
func resolveInstallPath() (string, error) {
	if v, ok := utils.GetEnv("BANTAY_AGENT_INSTALL_PATH"); ok && v != "" {
		return v, nil
	}
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return filepath.EvalSymlinks(exe)
}

// schedulePruneOldBackup removes <install>.bak after the given delay if the
// current install path resolves and the backup exists. The delay gives a
// brief manual-rollback window after a hub-pushed update before the .bak
// is swept; if the new binary crashes within the window, the supervisor
// loop keeps the agent down and the operator can `mv .bak` back.
func schedulePruneOldBackup(after time.Duration) {
	go func() {
		time.Sleep(after)
		path, err := resolveInstallPath()
		if err != nil {
			return
		}
		bak := path + ".bak"
		if _, err := os.Stat(bak); err != nil {
			return
		}
		if err := os.Remove(bak); err != nil {
			slog.Debug("prune .bak failed", "path", bak, "err", err)
			return
		}
		slog.Info("pruned old agent backup", "path", bak)
	}()
}

// installBinary writes data to <path>.new (same dir for atomic rename),
// fsyncs, then promotes: current → .bak, .new → current. Mode 0755.
func installBinary(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	tmp := path + ".new"
	out, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o755)
	if err != nil {
		return err
	}
	if _, err := out.Write(data); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Sync(); err != nil {
		out.Close()
		os.Remove(tmp)
		return err
	}
	if err := out.Close(); err != nil {
		os.Remove(tmp)
		return err
	}

	bak := path + ".bak"
	// Best-effort rotate of previous binary — missing source is fine.
	_ = os.Remove(bak)
	if _, err := os.Stat(path); err == nil {
		if err := os.Rename(path, bak); err != nil {
			os.Remove(tmp)
			return fmt.Errorf("rotate previous binary: %w", err)
		}
	}

	if err := os.Rename(tmp, path); err != nil {
		// Try to restore the previous binary so we don't end up with no agent at all.
		if _, statErr := os.Stat(bak); statErr == nil {
			_ = os.Rename(bak, path)
		}
		return fmt.Errorf("promote new binary: %w", err)
	}

	return nil
}

