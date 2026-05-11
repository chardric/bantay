package alerts

import (
	"encoding/json"
	"os"
	"strings"

	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
)

// BantayAlertParams is the JSON payload stored in the _params row id="bantay_settings".
// It carries the global alert-routing config so admins can pick which users receive
// every alert email without touching per-user notification settings.
type BantayAlertParams struct {
	AlertRecipientUserIds []string `json:"alertRecipientUserIds"`
	AlertRecipientEmails  []string `json:"alertRecipientEmails"`
	// DailyDigestEnabled toggles the once-per-day summary of currently-active
	// alerts. Recipients are the same global list above (or the per-user fallback
	// when the global list is empty), so it never goes to nobody.
	DailyDigestEnabled bool `json:"dailyDigestEnabled"`
	// DailyDigestHour is the local-time hour (0-23) the scheduler fires at.
	DailyDigestHour int `json:"dailyDigestHour"`
	// DailyDigestLastSent is set after a successful send (YYYY-MM-DD in local
	// time) so a hub restart at the digest hour cannot re-send the same day.
	DailyDigestLastSent string `json:"dailyDigestLastSent"`
}

const bantaySettingsParamsID = "bantay_settings"

// LoadBantayAlertParams reads the global alert routing config from _params.
// Missing row returns zero-value (empty list) — never errors.
func LoadBantayAlertParams(app core.App) BantayAlertParams {
	p := BantayAlertParams{AlertRecipientUserIds: []string{}}
	var raw string
	err := app.DB().NewQuery("SELECT value FROM _params WHERE id = {:id}").
		Bind(dbx.Params{"id": bantaySettingsParamsID}).
		Row(&raw)
	if err != nil || raw == "" {
		return p
	}
	_ = json.Unmarshal([]byte(raw), &p)
	if p.AlertRecipientUserIds == nil {
		p.AlertRecipientUserIds = []string{}
	}
	return p
}

// SaveBantayAlertParams upserts the global alert routing config into _params.
func SaveBantayAlertParams(app core.App, p BantayAlertParams) error {
	if p.AlertRecipientUserIds == nil {
		p.AlertRecipientUserIds = []string{}
	}
	if p.AlertRecipientEmails == nil {
		p.AlertRecipientEmails = []string{}
	}
	b, err := json.Marshal(p)
	if err != nil {
		return err
	}
	_, err = app.DB().NewQuery(`
		INSERT INTO _params (id, value, created, updated)
		VALUES ({:id}, {:value}, strftime('%Y-%m-%d %H:%M:%fZ'), strftime('%Y-%m-%d %H:%M:%fZ'))
		ON CONFLICT(id) DO UPDATE SET value = {:value}, updated = strftime('%Y-%m-%d %H:%M:%fZ')
	`).Bind(dbx.Params{
		"id":    bantaySettingsParamsID,
		"value": string(b),
	}).Execute()
	return err
}

// resolveGlobalRecipientEmails returns the email addresses to use as the To: list
// when a global recipient override is configured. Sources combined (deduped):
//  1. Account emails of any users picked in _params.AlertRecipientUserIds.
//  2. Free-form addresses in _params.AlertRecipientEmails.
//  3. Env var BANTAY_ALERT_RECIPIENT (comma-separated; only when 1 & 2 empty).
//
// Returns an empty slice when nothing is configured — caller falls back
// to the per-user notification email list.
func resolveGlobalRecipientEmails(app core.App) []string {
	seen := map[string]struct{}{}
	out := []string{}
	add := func(addr string) {
		addr = strings.TrimSpace(addr)
		if addr == "" {
			return
		}
		key := strings.ToLower(addr)
		if _, dup := seen[key]; dup {
			return
		}
		seen[key] = struct{}{}
		out = append(out, addr)
	}
	params := LoadBantayAlertParams(app)
	if len(params.AlertRecipientUserIds) > 0 {
		records, err := app.FindRecordsByIds("users", params.AlertRecipientUserIds)
		if err == nil {
			for _, r := range records {
				add(r.GetString("email"))
			}
		}
	}
	for _, e := range params.AlertRecipientEmails {
		add(e)
	}
	if len(out) > 0 {
		return out
	}
	if v := strings.TrimSpace(os.Getenv("BANTAY_ALERT_RECIPIENT")); v != "" {
		for _, raw := range strings.Split(v, ",") {
			add(raw)
		}
	}
	return out
}
