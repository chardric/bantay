package hub

import (
	"context"
	"net/http"
	"net/mail"
	"sort"
	"strconv"
	"strings"
	"time"

	validation "github.com/go-ozzo/ozzo-validation/v4"
	"github.com/pocketbase/dbx"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/mails"
	"github.com/pocketbase/pocketbase/tools/mailer"

	"bantay/internal/alerts"
)

// formatSaveError turns a PocketBase save error into a user-facing message.
// PocketBase returns ozzo-validation maps for field-level failures (e.g.
// "email: must be a valid email address"); we concat them so the operator
// sees the actual reason instead of a guessed-at default.
func formatSaveError(err error, fallback string) string {
	if err == nil {
		return fallback
	}
	if vErrs, ok := err.(validation.Errors); ok && len(vErrs) > 0 {
		fields := make([]string, 0, len(vErrs))
		for f := range vErrs {
			fields = append(fields, f)
		}
		sort.Strings(fields)
		parts := make([]string, 0, len(vErrs))
		for _, f := range fields {
			fe := vErrs[f]
			emsg := strings.ToLower(fe.Error())
			if f == "email" && (strings.Contains(emsg, "already") || strings.Contains(emsg, "duplicate") || strings.Contains(emsg, "exists") || strings.Contains(emsg, "unique")) {
				return "A user with that email already exists."
			}
			parts = append(parts, f+": "+fe.Error())
		}
		return strings.Join(parts, "; ")
	}
	if msg := strings.TrimSpace(err.Error()); msg != "" {
		return msg
	}
	return fallback
}

// Admin endpoints proxy PocketBase superuser-only operations through Beszel's
// own auth so that a Bantay user with role="admin" can manage users, backups,
// SMTP settings, and logs from the friendly main dashboard without ever needing
// to log into PocketBase's /_/ admin UI.

// ----- users -----

type adminUserResponse struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	Verified bool   `json:"verified"`
	Created  string `json:"created"`
}

func toAdminUser(r *core.Record) adminUserResponse {
	return adminUserResponse{
		ID:       r.Id,
		Email:    r.GetString("email"),
		Name:     r.GetString("name"),
		Role:     r.GetString("role"),
		Verified: r.GetBool("verified"),
		Created:  r.GetDateTime("created").String(),
	}
}

func (h *Hub) listUsers(e *core.RequestEvent) error {
	records, err := h.FindAllRecords("users")
	if err != nil {
		return e.InternalServerError("Failed to list users.", err)
	}
	out := make([]adminUserResponse, 0, len(records))
	for _, r := range records {
		out = append(out, toAdminUser(r))
	}
	return e.JSON(http.StatusOK, map[string]any{"items": out})
}

type createUserRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	Name     string `json:"name"`
	Role     string `json:"role"`
}

func (h *Hub) createUser(e *core.RequestEvent) error {
	req := new(createUserRequest)
	if err := e.BindBody(req); err != nil {
		return e.BadRequestError("Invalid request body.", err)
	}
	req.Email = strings.TrimSpace(req.Email)
	if req.Email == "" || req.Password == "" {
		return e.BadRequestError("Email and password are required.", nil)
	}
	if _, err := mail.ParseAddress(req.Email); err != nil {
		return e.BadRequestError("Invalid email address.", err)
	}
	if len(req.Password) < 8 {
		return e.BadRequestError("Password must be at least 8 characters.", nil)
	}
	if req.Role != "admin" && req.Role != "readonly" {
		req.Role = ""
	}

	col, err := h.FindCachedCollectionByNameOrId("users")
	if err != nil {
		return e.InternalServerError("Users collection unavailable.", err)
	}
	rec := core.NewRecord(col)
	rec.Set("email", req.Email)
	rec.Set("name", req.Name)
	rec.Set("role", req.Role)
	rec.Set("verified", true)
	rec.SetPassword(req.Password)
	if err := h.Save(rec); err != nil {
		return e.BadRequestError(formatSaveError(err, "Failed to create user."), err)
	}
	return e.JSON(http.StatusOK, toAdminUser(rec))
}

type updateUserRequest struct {
	Email    *string `json:"email"`
	Name     *string `json:"name"`
	Role     *string `json:"role"`
	Password *string `json:"password"`
	Verified *bool   `json:"verified"`
}

func (h *Hub) updateUser(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	if id == "" {
		return e.BadRequestError("Missing user id.", nil)
	}
	rec, err := h.FindRecordById("users", id)
	if err != nil {
		return e.NotFoundError("User not found.", err)
	}
	req := new(updateUserRequest)
	if err := e.BindBody(req); err != nil {
		return e.BadRequestError("Invalid request body.", err)
	}
	if req.Email != nil {
		em := strings.TrimSpace(*req.Email)
		if _, err := mail.ParseAddress(em); err != nil {
			return e.BadRequestError("Invalid email address.", err)
		}
		rec.Set("email", em)
	}
	if req.Name != nil {
		rec.Set("name", strings.TrimSpace(*req.Name))
	}
	if req.Role != nil {
		role := *req.Role
		if role != "admin" && role != "readonly" && role != "" {
			return e.BadRequestError("Role must be admin, readonly, or empty.", nil)
		}
		if id == e.Auth.Id && role != rec.GetString("role") {
			return e.BadRequestError("You cannot change your own role. Ask another admin.", nil)
		}
		// prevent removing the last admin
		if rec.GetString("role") == "admin" && role != "admin" {
			adminCount, err := h.countAdmins()
			if err == nil && adminCount <= 1 {
				return e.BadRequestError("Cannot demote the last remaining admin.", nil)
			}
		}
		rec.Set("role", role)
	}
	if req.Verified != nil {
		rec.Set("verified", *req.Verified)
	}
	if req.Password != nil && *req.Password != "" {
		if len(*req.Password) < 8 {
			return e.BadRequestError("Password must be at least 8 characters.", nil)
		}
		rec.SetPassword(*req.Password)
	}
	if err := h.Save(rec); err != nil {
		return e.BadRequestError(formatSaveError(err, "Failed to update user."), err)
	}
	return e.JSON(http.StatusOK, toAdminUser(rec))
}

func (h *Hub) deleteUser(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	if id == "" {
		return e.BadRequestError("Missing user id.", nil)
	}
	if id == e.Auth.Id {
		return e.BadRequestError("You cannot delete your own account.", nil)
	}
	rec, err := h.FindRecordById("users", id)
	if err != nil {
		return e.NotFoundError("User not found.", err)
	}
	if rec.GetString("role") == "admin" {
		adminCount, err := h.countAdmins()
		if err == nil && adminCount <= 1 {
			return e.BadRequestError("Cannot delete the last remaining admin.", nil)
		}
	}
	if err := h.Delete(rec); err != nil {
		return e.InternalServerError("Failed to delete user.", err)
	}
	return e.NoContent(http.StatusNoContent)
}

func (h *Hub) sendUserPasswordReset(e *core.RequestEvent) error {
	id := e.Request.PathValue("id")
	rec, err := h.FindRecordById("users", id)
	if err != nil {
		return e.NotFoundError("User not found.", err)
	}
	if err := mails.SendRecordPasswordReset(h.App, rec); err != nil {
		return e.InternalServerError("Failed to send password reset email. Check SMTP settings.", err)
	}
	return e.JSON(http.StatusOK, map[string]string{"status": "sent"})
}

func (h *Hub) countAdmins() (int, error) {
	records, err := h.FindAllRecords("users", dbx.HashExp{"role": "admin"})
	if err != nil {
		return 0, err
	}
	return len(records), nil
}

// ----- agents -----

// restartAgent asks an agent process to exit so its supervisor (docker/systemd)
// restarts it. Returns 200 immediately on ack from the agent; the agent will be
// briefly unreachable while it restarts.
func (h *Hub) restartAgent(e *core.RequestEvent) error {
	systemID := e.Request.URL.Query().Get("system")
	if systemID == "" {
		return e.BadRequestError("Missing system parameter.", nil)
	}
	system, err := h.sm.GetSystem(systemID)
	if err != nil {
		return e.NotFoundError("System not found.", err)
	}
	if err := system.RequestAgentRestart(); err != nil {
		return e.InternalServerError("Agent did not acknowledge restart. It may be offline or running an older version.", err)
	}
	return e.JSON(http.StatusOK, map[string]string{"status": "restarting"})
}

// ----- backups -----

type backupItem struct {
	Key     string    `json:"key"`
	Size    int64     `json:"size"`
	Modified time.Time `json:"modified"`
}

func (h *Hub) listBackups(e *core.RequestEvent) error {
	fsys, err := h.NewBackupsFilesystem()
	if err != nil {
		return e.InternalServerError("Failed to open backups filesystem.", err)
	}
	defer fsys.Close()
	files, err := fsys.List("")
	if err != nil {
		return e.InternalServerError("Failed to list backups.", err)
	}
	items := make([]backupItem, 0, len(files))
	for _, f := range files {
		if f.IsDir {
			continue
		}
		items = append(items, backupItem{Key: f.Key, Size: f.Size, Modified: f.ModTime})
	}
	return e.JSON(http.StatusOK, map[string]any{"items": items})
}

type createBackupRequest struct {
	Name string `json:"name"`
}

func (h *Hub) createBackup(e *core.RequestEvent) error {
	req := new(createBackupRequest)
	_ = e.BindBody(req)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	if err := h.CreateBackup(ctx, req.Name); err != nil {
		return e.InternalServerError("Failed to create backup. Another backup may be in progress.", err)
	}
	return e.JSON(http.StatusOK, map[string]string{"status": "created"})
}

func (h *Hub) restoreBackup(e *core.RequestEvent) error {
	key := e.Request.PathValue("key")
	if key == "" {
		return e.BadRequestError("Missing backup key.", nil)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()
	// RestoreBackup restarts the app process; the response will not be delivered.
	go func() {
		_ = h.RestoreBackup(ctx, key)
	}()
	return e.JSON(http.StatusOK, map[string]string{"status": "restoring"})
}

func (h *Hub) deleteBackup(e *core.RequestEvent) error {
	key := e.Request.PathValue("key")
	if key == "" {
		return e.BadRequestError("Missing backup key.", nil)
	}
	fsys, err := h.NewBackupsFilesystem()
	if err != nil {
		return e.InternalServerError("Failed to open backups filesystem.", err)
	}
	defer fsys.Close()
	if err := fsys.Delete(key); err != nil {
		return e.InternalServerError("Failed to delete backup.", err)
	}
	return e.NoContent(http.StatusNoContent)
}

// ----- SMTP settings -----

type smtpResponse struct {
	Enabled               bool     `json:"enabled"`
	Host                  string   `json:"host"`
	Port                  int      `json:"port"`
	Username              string   `json:"username"`
	HasPassword           bool     `json:"hasPassword"`
	AuthMethod            string   `json:"authMethod"`
	TLS                   bool     `json:"tls"`
	LocalName             string   `json:"localName"`
	SenderName            string   `json:"senderName"`
	SenderAddress         string   `json:"senderAddress"`
	AlertRecipientUserIds []string `json:"alertRecipientUserIds"`
	AlertRecipientEmails  []string `json:"alertRecipientEmails"`
	DailyDigestEnabled    bool     `json:"dailyDigestEnabled"`
	DailyDigestHour       int      `json:"dailyDigestHour"`
}

func (h *Hub) getSMTP(e *core.RequestEvent) error {
	s := h.Settings()
	params := alerts.LoadBantayAlertParams(h)
	resp := smtpResponse{
		Enabled:               s.SMTP.Enabled,
		Host:                  s.SMTP.Host,
		Port:                  s.SMTP.Port,
		Username:              s.SMTP.Username,
		HasPassword:           s.SMTP.Password != "",
		AuthMethod:            s.SMTP.AuthMethod,
		TLS:                   s.SMTP.TLS,
		LocalName:             s.SMTP.LocalName,
		SenderName:            s.Meta.SenderName,
		SenderAddress:         s.Meta.SenderAddress,
		AlertRecipientUserIds: params.AlertRecipientUserIds,
		AlertRecipientEmails:  params.AlertRecipientEmails,
		DailyDigestEnabled:    params.DailyDigestEnabled,
		DailyDigestHour:       params.DailyDigestHour,
	}
	return e.JSON(http.StatusOK, resp)
}

type smtpUpdateRequest struct {
	Enabled               bool     `json:"enabled"`
	Host                  string   `json:"host"`
	Port                  int      `json:"port"`
	Username              string   `json:"username"`
	Password              string   `json:"password"`
	AuthMethod            string   `json:"authMethod"`
	TLS                   bool     `json:"tls"`
	LocalName             string   `json:"localName"`
	SenderName            string   `json:"senderName"`
	SenderAddress         string   `json:"senderAddress"`
	AlertRecipientUserIds []string `json:"alertRecipientUserIds"`
	AlertRecipientEmails  []string `json:"alertRecipientEmails"`
	DailyDigestEnabled    bool     `json:"dailyDigestEnabled"`
	DailyDigestHour       int      `json:"dailyDigestHour"`
}

func (h *Hub) updateSMTP(e *core.RequestEvent) error {
	req := new(smtpUpdateRequest)
	if err := e.BindBody(req); err != nil {
		return e.BadRequestError("Invalid request body.", err)
	}
	if req.SenderAddress != "" {
		if _, err := mail.ParseAddress(req.SenderAddress); err != nil {
			return e.BadRequestError("Invalid sender email address.", err)
		}
	}
	settings, err := h.Settings().Clone()
	if err != nil {
		return e.InternalServerError("Failed to clone settings.", err)
	}
	settings.SMTP.Enabled = req.Enabled
	settings.SMTP.Host = strings.TrimSpace(req.Host)
	settings.SMTP.Port = req.Port
	settings.SMTP.Username = req.Username
	if req.Password != "" {
		settings.SMTP.Password = req.Password
	}
	settings.SMTP.AuthMethod = req.AuthMethod
	settings.SMTP.TLS = req.TLS
	settings.SMTP.LocalName = req.LocalName
	if req.SenderName != "" {
		settings.Meta.SenderName = req.SenderName
	}
	if req.SenderAddress != "" {
		settings.Meta.SenderAddress = req.SenderAddress
	}
	if err := h.Save(settings); err != nil {
		return e.BadRequestError("Failed to save SMTP settings.", err)
	}

	// Persist alert recipient list. Validate that each id resolves to a real
	// user record so a stale or typo'd id can't silently swallow alerts.
	cleanIds := make([]string, 0, len(req.AlertRecipientUserIds))
	if len(req.AlertRecipientUserIds) > 0 {
		records, err := h.FindRecordsByIds("users", req.AlertRecipientUserIds)
		if err != nil {
			return e.BadRequestError("Failed to validate recipient users.", err)
		}
		validIds := make(map[string]struct{}, len(records))
		for _, r := range records {
			validIds[r.Id] = struct{}{}
		}
		for _, id := range req.AlertRecipientUserIds {
			if _, ok := validIds[id]; ok {
				cleanIds = append(cleanIds, id)
			}
		}
		if len(cleanIds) != len(req.AlertRecipientUserIds) {
			return e.BadRequestError("One or more recipient users were not found.", nil)
		}
	}
	cleanEmails := make([]string, 0, len(req.AlertRecipientEmails))
	seenEmail := map[string]struct{}{}
	for _, raw := range req.AlertRecipientEmails {
		addr := strings.TrimSpace(raw)
		if addr == "" {
			continue
		}
		if _, err := mail.ParseAddress(addr); err != nil {
			return e.BadRequestError("Invalid recipient email address: "+addr, err)
		}
		key := strings.ToLower(addr)
		if _, dup := seenEmail[key]; dup {
			continue
		}
		seenEmail[key] = struct{}{}
		cleanEmails = append(cleanEmails, addr)
	}
	if req.DailyDigestHour < 0 || req.DailyDigestHour > 23 {
		return e.BadRequestError("Daily digest hour must be between 0 and 23.", nil)
	}
	// Preserve LastSent across this update — it's a server-side bookkeeping
	// field and should never be reset by a config save (otherwise editing the
	// recipient list at the digest hour would re-send today's email).
	existing := alerts.LoadBantayAlertParams(h)
	if err := alerts.SaveBantayAlertParams(h, alerts.BantayAlertParams{
		AlertRecipientUserIds: cleanIds,
		AlertRecipientEmails:  cleanEmails,
		DailyDigestEnabled:    req.DailyDigestEnabled,
		DailyDigestHour:       req.DailyDigestHour,
		DailyDigestLastSent:   existing.DailyDigestLastSent,
	}); err != nil {
		return e.BadRequestError("Failed to save alert recipients.", err)
	}
	return h.getSMTP(e)
}

type smtpTestRequest struct {
	To string `json:"to"`
}

func (h *Hub) testSMTP(e *core.RequestEvent) error {
	req := new(smtpTestRequest)
	if err := e.BindBody(req); err != nil {
		return e.BadRequestError("Invalid request body.", err)
	}
	to := strings.TrimSpace(req.To)
	if to == "" {
		return e.BadRequestError("Recipient email is required.", nil)
	}
	addr, err := mail.ParseAddress(to)
	if err != nil {
		return e.BadRequestError("Invalid recipient email.", err)
	}
	s := h.Settings()
	msg := &mailer.Message{
		From:    mail.Address{Name: s.Meta.SenderName, Address: s.Meta.SenderAddress},
		To:      []mail.Address{*addr},
		Subject: "Beszel test email",
		Text:    "This is a test email from your Bantay hub. If you can read this, your SMTP settings are working.",
	}
	if err := h.NewMailClient().Send(msg); err != nil {
		return e.BadRequestError("Failed to send test email: "+err.Error(), err)
	}
	return e.JSON(http.StatusOK, map[string]string{"status": "sent"})
}

// ----- logs -----

type logEntry struct {
	ID      string `json:"id"`
	Level   int    `json:"level"`
	Message string `json:"message"`
	Created string `json:"created"`
	Data    any    `json:"data,omitempty"`
}

func (h *Hub) listLogs(e *core.RequestEvent) error {
	q := e.Request.URL.Query()
	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	perPage, _ := strconv.Atoi(q.Get("perPage"))
	if perPage < 1 || perPage > 200 {
		perPage = 50
	}
	level, _ := strconv.Atoi(q.Get("level"))
	search := strings.TrimSpace(q.Get("q"))

	query := h.LogQuery().OrderBy("created DESC").Offset(int64((page - 1) * perPage)).Limit(int64(perPage))
	if q.Get("level") != "" {
		query = query.AndWhere(dbx.HashExp{"level": level})
	}
	if search != "" {
		query = query.AndWhere(dbx.Like("message", search))
	}

	logs := []*core.Log{}
	if err := query.All(&logs); err != nil {
		return e.InternalServerError("Failed to query logs.", err)
	}
	out := make([]logEntry, 0, len(logs))
	for _, l := range logs {
		out = append(out, logEntry{
			ID:      l.Id,
			Level:   l.Level,
			Message: l.Message,
			Created: l.Created.String(),
			Data:    l.Data,
		})
	}
	return e.JSON(http.StatusOK, map[string]any{
		"page":    page,
		"perPage": perPage,
		"items":   out,
	})
}

func (h *Hub) clearLogs(e *core.RequestEvent) error {
	if err := h.DeleteOldLogs(time.Now()); err != nil {
		return e.InternalServerError("Failed to clear logs.", err)
	}
	return e.NoContent(http.StatusNoContent)
}
