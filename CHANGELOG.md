# Changelog

All notable changes to **Bantay** (the fork) are documented here. The upstream Beszel changelog is unaffected; see [henrygd/beszel](https://github.com/henrygd/beszel/releases) for upstream releases.

This project follows [Semantic Versioning](https://semver.org/) for the fork's own version line, independent of upstream.

## [1.0.0] — 2026-05-05

Initial fork release. Diverged from upstream Beszel as of upstream commit `c1c1cd1b` ("ui: fix temperature chart filtering"), then full rebrand and feature work.

### Added

- **Cross-vendor GPU collector via DRM fdinfo** (`agent/gpu_drm_fdinfo_linux.go`). Reads `drm-engine-*` ns counters from `/proc/<pid>/fdinfo/*`, aggregates per PCI device, diffs over a 3 s interval to compute busy %. Works for amdgpu ≥5.14, i915 ≥5.19, xe ≥6.8, V3D ≥6.6, Panfrost ≥6.6, msm ≥6.0. Wired in `agent/gpu.go` as a no-group fallback that runs only when no vendor collector claims a group.
- **Per-NIC link speed** field on the `system.Info` struct (`LinkSpeeds map[string]uint32`, CBOR key 24). Agent reads `/sys/class/net/<iface>/{operstate,speed}` per cycle. UI: NIC strip on the system detail page, plus a LAN column in the systems table showing the highest active NIC speed with color coding.
- **Memory + disk totals** on the `Info` struct (`MemTotal`, `DiskSize`, CBOR keys 25 / 26). UI: "X.X / Y.Y GB" appended to the Memory and Disk cells in the systems table.
- **Restart-agent action** (`common.RestartAgent`, WebSocketAction). Hub admin endpoint `POST /api/bantay/admin/agents/restart?system=<id>` and a UI button on the system detail info bar (admin-only, confirm dialog). Agent `RestartAgentHandler` sends an ack then `os.Exit(0)` after 500 ms; supervisor (docker `restart: unless-stopped` or systemd `Restart=always`) brings it back.
- **Friendly admin pages** in Settings: Users, Email, Backups, Activity log, About — backed by `/api/bantay/admin/*` endpoints in `internal/hub/admin.go`, gated by `requireAdminRole`. No need to log into the PocketBase `/_/` admin UI for routine operations.
- **Self-role demotion guard** (server + UI). `internal/hub/admin.go updateUser` rejects role change when `id==e.Auth.Id`; the EditDialog disables the Role select with a hint when editing self. Mirrors the existing self-delete guard.
- **Self-password change** keeps the session alive. EditDialog re-authenticates with the new password after the PATCH succeeds (PocketBase rotates `tokenKey` on password change, invalidating the current token); falls back to a clean "please sign in again" redirect on re-auth failure.
- **Auto-disk-discovery deploy script** at `docker/deploy-agent.sh`. Uses `findmnt --real --list` over SSH to enumerate every block-device-backed mountpoint on a target host, filters out `/`, `/boot*`, `/var/lib/docker*`, then generates a docker-compose.yml with one `/extra-filesystems/<basename>:ro` bind per remaining mount + `pid: host`, SCPs binary + Dockerfile.thin + compose, builds the image on the host, recreates the container.
- **Sidebar UI** (collapsible icon-rail + mobile drawer) in `internal/site/src/components/sidebar.tsx`. Replaces upstream's top navbar.
- **Dashboard route** at `/` (`internal/site/src/components/routes/dashboard.tsx`) with status tiles (Total/Up/Down/Paused), fleet gauges, top-N consumers, ActiveAlerts, RecentActivity. Systems table moved to `/systems`.
- **SMTP form Lock/Unlock toggle** (default locked) to prevent accidental edits; auto-relocks after a successful save.
- **Logo + favicon**: 2U server-rack SVG icon + "Bantay" wordmark.
- **Load Average** column hover tooltip with per-window normalized %, plus an inline normalized % next to the raw 1m/5m/15m numbers.
- **IP** column in the systems table.
- **Containers page** grouped per system, with Table/Grid view toggle.
- **`responsiveClass` field** on systems-table and containers-table column definitions to CSS-hide low-priority columns at narrow widths.

### Changed

- **Full rebrand**: Go module `github.com/henrygd/beszel` → `bantay`, root package `package beszel` → `package bantay`, `beszel.go` → `bantay.go`, all import paths, API endpoints `/api/beszel/*` → `/api/bantay/*`, types `BeszelInfo` → `BantayInfo`, global `globalThis.BESZEL` → `globalThis.BANTAY`, env vars (`BANTAY_HEARTBEAT*`), volume paths (`/bantay_data`, `/var/lib/bantay-agent`), image tags (`bantay-local/*`), container names (`bantay-hub`, `bantay-agent`, `bantay-backup`), systemd service (`bantay-agent.service`).
- **English-only UI**: `getLocale()` and `dynamicActivate()` in `internal/site/src/lib/i18n.ts` are forced to `"en"` (loads bundled en messages). Language picker removed.
- **Poll interval** lowered from 60 s → 5 s in `internal/hub/systems/system_manager.go`. ~12× more SQLite writes; watch disk if monitoring many systems.
- **Agent image base** is `debian:13-slim` (was `alpine`) so `nvtop` is available from the distro repo. `intel-gpu-tools` deliberately not installed because `intel_gpu_top` fails in containers due to PMU permission requirements and would mask the working DRM fdinfo path.
- **`hasAmdSysfs`** now also requires `gpu_busy_percent` to be readable, not just vendor=`0x1002`. Old AMD cards on the radeon driver fall through to the DRM fdinfo collector instead of claiming the AMD vendor group.
- **About page** restructured: shows "Original author" (henrygd, with link to upstream repo) and "Modified by" (this fork's maintainer) as two distinct sections. License section explicitly notes MIT is inherited.

### Removed

- **Webhook / Shoutrrr** notifications section in Settings. SMTP-only.
- **Heartbeat** settings tab.
- **Update polling** (`/api/bantay/update`) and the `$newVersion` banner. Updates are pushed by the operator.
- **Agent-version column** from the systems table.
- **Battery column** from the systems table.
- **Services column** from the systems table — alpine/debian agent containers don't have systemd, and the native agent on ORANGEPI runs as user `beszel` without DBus access, so the column was structurally always 0%.

### Notes for users

- The fork's deployment pattern (hub on one host, per-host agent thin builds) is documented in [README.md](readme.md) and the deploy script's header comment. The previous upstream "single docker compose with henrygd/beszel images" pattern still works but isn't the focus.
- The hub's SSH ed25519 keypair is generated at first hub start; the public key must be set in every agent's `KEY` env var. If the hub data dir is wiped, agents must be re-keyed.
- Adding a new system in the UI is still a manual step (host = IP, port = 45876).

[1.0.0]: https://github.com/henrygd/beszel/compare/c1c1cd1b...HEAD
