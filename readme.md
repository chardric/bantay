# Bantay

> **Bantay** is a personal homelab fork of [Beszel](https://github.com/henrygd/beszel), tailored for a small fleet of bare-metal and SBC hosts. All credit for the underlying monitoring platform belongs to the upstream project and its author, **henrygd**. This fork preserves the upstream MIT license and copyright.

A lightweight agent + hub server-monitoring stack: Docker stats, historical metrics, alerting, container details, S.M.A.R.T., per-NIC link speed, and admin UI — all from a single bind-mounted data directory.

## Relationship to upstream Beszel

Bantay is a **fork**, not a rewrite. The agent + hub architecture, PocketBase backend, transport layer, and the bulk of the Go and React code remain Beszel's. What this fork changes:

- **Rebrand**: Go module `bantay`, root package `package bantay`, API endpoints `/api/bantay/*`, env vars (`BANTAY_HEARTBEAT*`), volume paths (`/bantay_data`, `/var/lib/bantay-agent`), image tags (`bantay-local/*`), container names, systemd service.
- **Sidebar UI** (collapsible icon-rail + mobile drawer) replaces the upstream top navbar.
- **Dashboard route** at `/` with status tiles, fleet gauges, top-N consumers, active alerts, recent activity. Systems table moved to `/systems`.
- **Friendly admin pages** in Settings (Users / Email / Backups / Activity log / About) backed by `/api/bantay/admin/*` endpoints, gated by `requireAdminRole`. No need to log into the PocketBase `/_/` admin UI for routine operations.
- **Restart-agent button** on the system detail page (admin-only, confirm dialog) — sends a `RestartAgent` action over the existing SSH channel; the agent exits cleanly and its supervisor (docker/systemd) restarts it.
- **Per-NIC link speed** strip on the system detail page (green ≥1 Gbps, amber <1 Gbps, red = down). Agent reads `/sys/class/net/<iface>/{operstate,speed}` per metric collection cycle.
- **Cross-vendor GPU collector via DRM fdinfo** (`agent/gpu_drm_fdinfo_linux.go`) — reads `drm-engine-*` ns counters from `/proc/<pid>/fdinfo/*` and aggregates per-PCI-device. Works for any modern DRM driver that emits these counters (amdgpu ≥5.14, i915 ≥5.19, xe ≥6.8, V3D ≥6.6, Panfrost ≥6.6, msm ≥6.0).
- **Auto-disk-discovery deploy script** at `docker/deploy-agent.sh` — uses `findmnt --real --list` over SSH to enumerate every block-device-backed mountpoint on a target host, then generates a docker-compose.yml with one `/extra-filesystems/<basename>:ro` bind per disk. No more per-host hand-editing.
- **Self-role demotion guard** (server + UI) — admins can't accidentally lock themselves out by changing their own role from the Edit User dialog.
- **Self-password change** keeps the session alive — re-authenticates with the new password after the PATCH succeeds, instead of silently logging the user out (PocketBase rotates `tokenKey` on password change).
- **Memory used/total** and **disk used/total** appended in the systems table cells (new `MemTotal` / `DiskSize` fields on the `Info` struct).
- **Load Average** column has a hover tooltip with the three windows (1m / 5m / 15m), per-window normalized %, and a one-line interpretation legend.
- **LAN** and **IP** columns added to the systems table.
- **English-only UI** — language picker removed; `getLocale()` and `dynamicActivate()` in `internal/site/src/lib/i18n.ts` are forced to `"en"`.
- **5-second poll interval** (`internal/hub/systems/system_manager.go` const `interval = 5_000`), down from upstream's 60 s. Watch SQLite write volume if you scale up.
- **Removed from UI**: webhook/Shoutrrr notifications section, heartbeat settings tab, agent self-update polling + `$newVersion` banner, agent-version column, battery column. Backend code remains in place but unreached from the UI.
- **Logo + favicon**: 2U server-rack SVG icon + "Bantay" wordmark.

## Architecture

Same as upstream:

- **Hub**: PocketBase-based web app + REST API. Bind-mounts `./data/hub` to `/bantay_data` for the SQLite database, file uploads, and the SSH keypair used to authenticate to agents.
- **Agent**: Runs on each monitored host. Listens for SSH connections from the hub on TCP port 45876 (configurable via `LISTEN`). The hub uses an ed25519 keypair generated at first hub start; the corresponding public key is set in every agent's `KEY` env var.

## Quick start (build from source)

```bash
git clone https://github.com/<your-fork>/bantay.git
cd bantay
cp .env.example .env
./install.sh
```

`install.sh` runs `docker compose up -d --build` for the hub + a local agent with healthchecks. Open `http://localhost:8090` and create the first admin account.

## Production homelab pattern

Hub on one host, agents on N remote hosts. After the hub is up and you have its SSH public key:

```bash
# Cross-compile agents (one binary per arch your fleet uses)
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -ldflags "-w -s" \
    -o /tmp/bantay-agent-builds/agent-amd64 ./internal/cmd/agent
GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build -ldflags "-w -s" \
    -o /tmp/bantay-agent-builds/agent-arm64 ./internal/cmd/agent
GOOS=linux GOARCH=arm GOARM=7 CGO_ENABLED=0 go build -ldflags "-w -s" \
    -o /tmp/bantay-agent-builds/agent-armv7 ./internal/cmd/agent

# Deploy to each host (auto-discovers disks, mounts each as /extra-filesystems/X)
docker/deploy-agent.sh <host_ip> <amd64|arm64|armv7>
```

The agent image (`docker/Dockerfile.thin`) is `debian:13-slim + smartmontools + nvtop` — small, no vendor GPU binaries needed (kernel sysfs + DRM fdinfo handle that).

For the native-binary path (no docker), copy the cross-compiled binary to `/opt/bantay-agent/bantay-agent` and install a `bantay-agent.service` systemd unit with `Restart=always`.

## What's NOT supported in this fork

- Old AMD radeon-driver GPUs (pre-GCN). The driver doesn't expose `drm-engine-*` fdinfo counters, so utilization is unmonitored.
- Mali-400/450 (Lima driver). No fdinfo support upstream.
- Internationalization. The UI is forced English; PR'ing language support back upstream is welcome but not in this fork's scope.
- The systemd-services tracking signal is unreached in our deployment (alpine/debian agent containers don't have systemd; the ORANGEPI native agent runs as a non-root user without DBus access).

## License

Bantay inherits the **MIT License** from upstream Beszel. See [LICENSE](LICENSE) for the full text and copyright notices. The fork modifications are also released under MIT.

## Credits

- **Upstream Beszel** — [henrygd/beszel](https://github.com/henrygd/beszel). The platform, the ideas, and the hard work this fork builds on.
- **Bantay modifications** — Richard R. Ayuyang ([chadlinuxtech.net](https://chadlinuxtech.net)).

If you're looking for the general-purpose, broadly-tested monitoring tool, use **upstream Beszel** — it's the supported, documented project. Bantay is a personal fork with deployment-specific customizations.
