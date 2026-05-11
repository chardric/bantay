package alerts

import (
	"fmt"
	"net/mail"
	"sort"
	"strings"
	"time"

	"github.com/pocketbase/pocketbase/tools/mailer"
)

// digestTickInterval is how often the scheduler checks the wall clock.
// 60s is the smallest sane resolution — finer-grained makes no sense for
// an hour-of-day trigger, coarser would risk skipping the window.
const digestTickInterval = 60 * time.Second

// startDigestScheduler launches the background loop that fires sendDailyDigest
// at the user-configured local hour. It returns immediately; the goroutine
// runs for the lifetime of the process. Safe to call once on hub startup.
func (am *AlertManager) startDigestScheduler() {
	go func() {
		t := time.NewTicker(digestTickInterval)
		defer t.Stop()
		for range t.C {
			am.maybeSendDailyDigest()
		}
	}()
}

// maybeSendDailyDigest is the per-tick gate: enabled? right hour? not yet
// today? If all yes, send and persist today's date so a hub restart at the
// digest hour cannot re-send.
func (am *AlertManager) maybeSendDailyDigest() {
	params := LoadBantayAlertParams(am.hub)
	if !params.DailyDigestEnabled {
		return
	}
	now := time.Now()
	if now.Hour() != params.DailyDigestHour {
		return
	}
	today := now.Format("2006-01-02")
	if params.DailyDigestLastSent == today {
		return
	}
	if err := am.sendDailyDigest(now); err != nil {
		am.hub.Logger().Error("Daily digest send failed", "err", err)
		return
	}
	params.DailyDigestLastSent = today
	if err := SaveBantayAlertParams(am.hub, params); err != nil {
		am.hub.Logger().Error("Daily digest sent but failed to persist last-sent date", "err", err)
	}
}

// activeAlertRow is the joined shape used to build the digest body.
type activeAlertRow struct {
	SystemID   string  `db:"system_id"`
	SystemName string  `db:"system_name"`
	AlertName  string  `db:"alert_name"`
	Threshold  float64 `db:"threshold"`
}

// sendDailyDigest queries currently-triggered alerts, groups them by system,
// and emails the global recipient list. Returns nil (and logs an info) when
// nothing is active or no recipients are configured — silent days are by design.
func (am *AlertManager) sendDailyDigest(now time.Time) error {
	var rows []activeAlertRow
	err := am.hub.DB().NewQuery(`
		SELECT a.system AS system_id,
		       s.name   AS system_name,
		       a.name   AS alert_name,
		       a.value  AS threshold
		FROM alerts a
		JOIN systems s ON a.system = s.id
		WHERE a.triggered = true
		ORDER BY s.name, a.name
	`).All(&rows)
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		am.hub.Logger().Info("Daily digest: no active alerts, skipping")
		return nil
	}

	// Recipients: the same global override used by per-event alerts. We do
	// not fall back to the per-user list here — a digest is a global broadcast
	// by definition, so an empty list means "no one configured to receive it."
	emails := resolveGlobalRecipientEmails(am.hub)
	if len(emails) == 0 {
		am.hub.Logger().Warn("Daily digest: no recipients configured, skipping",
			"active_alerts", len(rows))
		return nil
	}

	body, hasTemp := am.formatDigestBody(now, rows)
	if hasTemp {
		body += "\n\n" + temperatureReference()
	}

	addresses := make([]mail.Address, 0, len(emails))
	for _, e := range emails {
		addresses = append(addresses, mail.Address{Address: e})
	}
	firedAt := now.Format("2006-01-02 15:04:05 MST")
	subject := fmt.Sprintf("[%s] Daily Bantay digest — %s",
		firedAt, pluralize(len(rows), "active alert", "active alerts"))

	msg := mailer.Message{
		To:      addresses,
		Subject: subject,
		Text:    "Time: " + firedAt + "\n\n" + body,
		From: mail.Address{
			Address: am.hub.Settings().Meta.SenderAddress,
			Name:    am.hub.Settings().Meta.SenderName,
		},
	}
	if err := am.hub.NewMailClient().Send(&msg); err != nil {
		return err
	}
	am.hub.Logger().Info("Sent daily digest",
		"to", msg.To, "active_alerts", len(rows))
	return nil
}

// formatDigestBody renders the human-readable summary. Returns the body and a
// flag indicating whether any temperature alert is present (so the caller knows
// whether to append the reference legend).
func (am *AlertManager) formatDigestBody(now time.Time, rows []activeAlertRow) (string, bool) {
	type sysGroup struct {
		name   string
		alerts []activeAlertRow
	}
	bySystem := map[string]*sysGroup{}
	order := []string{}
	for _, r := range rows {
		g, ok := bySystem[r.SystemID]
		if !ok {
			g = &sysGroup{name: r.SystemName}
			bySystem[r.SystemID] = g
			order = append(order, r.SystemID)
		}
		g.alerts = append(g.alerts, r)
	}
	sort.SliceStable(order, func(i, j int) bool {
		return strings.ToLower(bySystem[order[i]].name) < strings.ToLower(bySystem[order[j]].name)
	})

	var b strings.Builder
	fmt.Fprintf(&b, "%s with active alerts:\n\n",
		pluralize(len(order), "system", "systems"))

	hasTemp := false
	hubLink := am.hub.MakeLink()
	for _, sysID := range order {
		g := bySystem[sysID]
		fmt.Fprintf(&b, "• %s\n", g.name)
		for _, a := range g.alerts {
			line := formatAlertLine(a)
			fmt.Fprintf(&b, "    - %s\n", line)
			if a.AlertName == "Temperature" {
				hasTemp = true
				if hint := safeTempHint(g.name); hint != "" {
					fmt.Fprintf(&b, "      (%s)\n", hint)
				}
			}
		}
		fmt.Fprintf(&b, "    %s\n", am.hub.MakeLink("system", sysID))
		b.WriteString("\n")
	}
	fmt.Fprintf(&b, "Open dashboard: %s", hubLink)
	return b.String(), hasTemp
}

// formatAlertLine turns one row into a single descriptive line. We only know
// the threshold (alerts.value) — the live measurement is not stored on the
// alert record. Recipients can click through to the dashboard for current values.
func formatAlertLine(a activeAlertRow) string {
	switch a.AlertName {
	case "Status":
		return "System down"
	case "Battery":
		return fmt.Sprintf("Battery below %g%%", a.Threshold)
	case "Temperature":
		return fmt.Sprintf("Temperature above %g°C", a.Threshold)
	case "CPU", "Memory", "Disk", "GPU":
		return fmt.Sprintf("%s above %g%%", a.AlertName, a.Threshold)
	case "Bandwidth":
		return fmt.Sprintf("Bandwidth above %g MB/s", a.Threshold)
	}
	if strings.HasPrefix(a.AlertName, "LoadAvg") {
		return fmt.Sprintf("%s above %g", a.AlertName, a.Threshold)
	}
	return fmt.Sprintf("%s alert (threshold %g)", a.AlertName, a.Threshold)
}

// safeTempHint returns a per-device-class safe-temperature reference picked
// from the system name. Heuristic only — recipients still see the full legend
// at the bottom. Empty string means "no specific hint, see legend."
func safeTempHint(systemName string) string {
	n := strings.ToLower(systemName)
	switch {
	case containsAny(n, "rpi", "raspberry", "pi3", "pi4", "pi5", "rpi3", "rpi4", "rpi5"):
		return "Raspberry Pi: throttles at 80–85°C, hard limit ~85°C"
	case containsAny(n, "synology", "qnap", "truenas", "freenas", "nas"):
		return "NAS chassis: ≤45°C ambient; HDDs ≤45°C for full lifespan"
	case containsAny(n, "switch", "router", "ap-", "unifi", "mikrotik", "omada"):
		return "Network gear: typically rated for ≤40–45°C ambient"
	case containsAny(n, "edgepi", "jetson"):
		return "Embedded SoC: throttles ~85°C, hard limit ~95°C"
	case containsAny(n, "elitedesk", "optiplex", "thinkcentre", "nuc", "minipc", "mini-pc"):
		return "Mini/SFF PC: CPU ≤80°C sustained; verify chassis airflow"
	}
	return "Generic CPU/server: ≤80°C sustained, throttles 90–100°C"
}

// temperatureReference is the standing footer included whenever the digest
// contains at least one Temperature alert. Sources: Backblaze HDD reliability
// reports, ASHRAE TC9.9 datacenter classes, RPi BCM2837/2711/2712 datasheets,
// Intel/AMD CPU TjMax tables.
func temperatureReference() string {
	return strings.Join([]string{
		"Reference — safe operating temperatures:",
		"  CPU desktop/server : ≤80°C sustained · throttle 90–100°C · damage >100°C",
		"  Raspberry Pi       : ≤80°C (RPi 3/4 throttle 80°C, RPi 5 throttle 85°C)",
		"  GPU consumer       : ≤83°C (NVIDIA/AMD)",
		"  GPU datacenter     : ≤90°C (A100/H100/MI series)",
		"  HDD                : 25–45°C ideal · ≤50°C to preserve lifespan (Backblaze)",
		"  SSD / NVMe         : 30–50°C ideal · throttles ~70°C · max 70–80°C",
		"  Server room / NAS  : 18–27°C ambient (ASHRAE A1 recommended), max 32°C",
		"  Network switches   : ≤40–45°C ambient (vendor-specific)",
	}, "\n")
}

// pluralize returns "1 thing" or "n things" depending on n.
func pluralize(n int, singular, plural string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, singular)
	}
	return fmt.Sprintf("%d %s", n, plural)
}

func containsAny(s string, needles ...string) bool {
	for _, n := range needles {
		if strings.Contains(s, n) {
			return true
		}
	}
	return false
}
