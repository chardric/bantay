import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { redirectPage } from "@nanostores/router"
import { ClockIcon, Loader2Icon, LockIcon, MailIcon, PlusIcon, SaveIcon, SendIcon, UnlockIcon, UsersIcon, XIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { $router } from "@/components/router"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { toast } from "@/components/ui/use-toast"
import { isAdmin, pb } from "@/lib/api"

type SmtpConfig = {
	enabled: boolean
	host: string
	port: number
	username: string
	hasPassword: boolean
	authMethod: string
	tls: boolean
	localName: string
	senderName: string
	senderAddress: string
	alertRecipientUserIds: string[]
	alertRecipientEmails: string[]
	dailyDigestEnabled: boolean
	dailyDigestHour: number
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type RecipientUser = {
	id: string
	email: string
	name: string
	role: string
}

function showApiError(err: unknown, fallback: string) {
	const e = err as { message?: string; data?: { message?: string } }
	toast({ title: t`Error`, description: e?.data?.message || e?.message || fallback, variant: "destructive" })
}

export default function MailSettings() {
	if (!isAdmin()) {
		redirectPage($router, "settings", { name: "general" })
	}
	const [cfg, setCfg] = useState<SmtpConfig | null>(null)
	const [users, setUsers] = useState<RecipientUser[]>([])
	const [password, setPassword] = useState("")
	const [saving, setSaving] = useState(false)
	const [testing, setTesting] = useState(false)
	const [testTo, setTestTo] = useState("")
	const [locked, setLocked] = useState(true)
	const [emailDraft, setEmailDraft] = useState("")

	async function load() {
		try {
			const [cfgRes, usersRes] = await Promise.all([
				pb.send<SmtpConfig>("/api/bantay/admin/settings/smtp", {}),
				pb.send<{ items: RecipientUser[] }>("/api/bantay/admin/users", {}),
			])
			setCfg({
				...cfgRes,
				alertRecipientUserIds: cfgRes.alertRecipientUserIds ?? [],
				alertRecipientEmails: cfgRes.alertRecipientEmails ?? [],
				dailyDigestEnabled: cfgRes.dailyDigestEnabled ?? false,
				dailyDigestHour: typeof cfgRes.dailyDigestHour === "number" ? cfgRes.dailyDigestHour : 8,
			})
			setUsers(usersRes.items ?? [])
			setTestTo(pb.authStore.record?.email ?? "")
		} catch (err) {
			showApiError(err, t`Failed to load SMTP settings.`)
		}
	}

	useEffect(() => {
		load()
	}, [])

	function toggleRecipient(id: string, checked: boolean) {
		if (!cfg) return
		const current = cfg.alertRecipientUserIds ?? []
		const next = checked ? Array.from(new Set([...current, id])) : current.filter((x) => x !== id)
		setCfg({ ...cfg, alertRecipientUserIds: next })
	}

	function addEmailChip() {
		if (!cfg) return
		const v = emailDraft.trim()
		if (!v) return
		if (!emailRegex.test(v)) {
			toast({ title: t`Invalid email address`, description: v, variant: "destructive" })
			return
		}
		const lower = v.toLowerCase()
		const current = cfg.alertRecipientEmails ?? []
		if (current.some((x) => x.toLowerCase() === lower)) {
			setEmailDraft("")
			return
		}
		setCfg({ ...cfg, alertRecipientEmails: [...current, v] })
		setEmailDraft("")
	}

	function removeEmailChip(addr: string) {
		if (!cfg) return
		setCfg({
			...cfg,
			alertRecipientEmails: (cfg.alertRecipientEmails ?? []).filter((x) => x !== addr),
		})
	}

	async function handleSave(e: React.FormEvent) {
		e.preventDefault()
		if (!cfg) return
		setSaving(true)
		try {
			const body = { ...cfg, password }
			const res = await pb.send<SmtpConfig>("/api/bantay/admin/settings/smtp", { method: "PUT", body })
			setCfg(res)
			setPassword("")
			setLocked(true)
			toast({ title: t`Email settings saved` })
		} catch (err) {
			showApiError(err, t`Failed to save settings.`)
		} finally {
			setSaving(false)
		}
	}

	async function handleTest() {
		if (!testTo) return
		setTesting(true)
		try {
			await pb.send("/api/bantay/admin/settings/smtp/test", { method: "POST", body: { to: testTo } })
			toast({ title: t`Test email sent`, description: testTo })
		} catch (err) {
			showApiError(err, t`Failed to send test email.`)
		} finally {
			setTesting(false)
		}
	}

	if (!cfg) {
		return (
			<div className="py-10 grid place-items-center text-muted-foreground">
				<Loader2Icon className="size-5 animate-spin" />
			</div>
		)
	}

	return (
		<div>
			<div>
				<h3 className="text-xl font-medium mb-2">
					<Trans>Email</Trans>
				</h3>
				<p className="text-sm text-muted-foreground leading-relaxed">
					<Trans>
						Configure how Bantay sends email — for password resets, alerts, and notifications. Ask your email provider
						or admin if you don't know these values.
					</Trans>
				</p>
			</div>
			<Separator className="my-4" />

			<form onSubmit={handleSave} className="space-y-5 max-w-2xl">
				{locked ? (
					<div className="flex items-center gap-3 rounded-md border bg-muted/30 p-3">
						<LockIcon className="size-4 text-muted-foreground shrink-0" />
						<span className="text-sm flex-1">
							<Trans>Settings are locked to prevent accidental changes.</Trans>
						</span>
						<Button type="button" variant="outline" size="sm" onClick={() => setLocked(false)} className="gap-1.5">
							<UnlockIcon className="size-4" />
							<Trans>Unlock to edit</Trans>
						</Button>
					</div>
				) : (
					<div className="flex items-center gap-3 rounded-md border border-amber-500/50 bg-amber-500/5 p-3">
						<UnlockIcon className="size-4 text-amber-600 dark:text-amber-500 shrink-0" />
						<span className="text-sm flex-1">
							<Trans>Editing is unlocked. Save or lock when done.</Trans>
						</span>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => {
								setLocked(true)
								setPassword("")
								load()
							}}
							className="gap-1.5"
						>
							<LockIcon className="size-4" />
							<Trans>Lock</Trans>
						</Button>
					</div>
				)}

				<div className="flex items-center justify-between gap-4 rounded-md border p-4">
					<div>
						<Label htmlFor="smtp-enabled" className="text-base font-medium">
							<Trans>Enable email sending</Trans>
						</Label>
						<p className="text-sm text-muted-foreground">
							<Trans>When off, no emails are sent (alerts still appear in the UI).</Trans>
						</p>
					</div>
					<Switch
						id="smtp-enabled"
						checked={cfg.enabled}
						disabled={locked}
						onCheckedChange={(v) => setCfg({ ...cfg, enabled: v })}
					/>
				</div>

				<div className="grid gap-4 sm:grid-cols-3">
					<div className="grid gap-1.5 sm:col-span-2">
						<Label htmlFor="smtp-host">
							<Trans>SMTP server</Trans>
						</Label>
						<Input
							id="smtp-host"
							placeholder="smtp.example.com"
							value={cfg.host}
							disabled={locked}
							onChange={(e) => setCfg({ ...cfg, host: e.target.value })}
						/>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="smtp-port">
							<Trans>Port</Trans>
						</Label>
						<Input
							id="smtp-port"
							type="number"
							value={cfg.port || ""}
							disabled={locked}
							onChange={(e) => setCfg({ ...cfg, port: parseInt(e.target.value, 10) || 0 })}
						/>
					</div>
				</div>

				<div className="grid gap-4 sm:grid-cols-2">
					<div className="grid gap-1.5">
						<Label htmlFor="smtp-username">
							<Trans>Username</Trans>
						</Label>
						<Input
							id="smtp-username"
							autoComplete="off"
							value={cfg.username}
							disabled={locked}
							onChange={(e) => setCfg({ ...cfg, username: e.target.value })}
						/>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="smtp-password">
							<Trans>Password</Trans>
						</Label>
						<Input
							id="smtp-password"
							type="password"
							autoComplete="new-password"
							placeholder={cfg.hasPassword ? t`Leave blank to keep current` : t`Enter password`}
							value={password}
							disabled={locked}
							onChange={(e) => setPassword(e.target.value)}
						/>
					</div>
				</div>

				<div className="grid gap-4 sm:grid-cols-2">
					<div className="grid gap-1.5">
						<Label htmlFor="smtp-auth">
							<Trans>Auth method</Trans>
						</Label>
						<Select
							value={cfg.authMethod || "PLAIN"}
							disabled={locked}
							onValueChange={(v) => setCfg({ ...cfg, authMethod: v })}
						>
							<SelectTrigger id="smtp-auth">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="PLAIN">PLAIN</SelectItem>
								<SelectItem value="LOGIN">LOGIN</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div className="flex items-end justify-between gap-4 rounded-md border p-4">
						<div>
							<Label htmlFor="smtp-tls" className="text-sm font-medium">
								<Trans>Force TLS</Trans>
							</Label>
							<p className="text-xs text-muted-foreground">
								<Trans>Off uses STARTTLS if available.</Trans>
							</p>
						</div>
						<Switch
							id="smtp-tls"
							checked={cfg.tls}
							disabled={locked}
							onCheckedChange={(v) => setCfg({ ...cfg, tls: v })}
						/>
					</div>
				</div>

				<Separator />

				<div>
					<h4 className="text-base font-medium mb-1">
						<Trans>From address</Trans>
					</h4>
					<p className="text-sm text-muted-foreground mb-3">
						<Trans>Who emails from Bantay appear to come from.</Trans>
					</p>
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="grid gap-1.5">
							<Label htmlFor="smtp-from-name">
								<Trans>Sender name</Trans>
							</Label>
							<Input
								id="smtp-from-name"
								value={cfg.senderName}
								disabled={locked}
								onChange={(e) => setCfg({ ...cfg, senderName: e.target.value })}
							/>
						</div>
						<div className="grid gap-1.5">
							<Label htmlFor="smtp-from-addr">
								<Trans>Sender email</Trans>
							</Label>
							<Input
								id="smtp-from-addr"
								type="email"
								placeholder="noreply@example.com"
								value={cfg.senderAddress}
								disabled={locked}
								onChange={(e) => setCfg({ ...cfg, senderAddress: e.target.value })}
							/>
						</div>
					</div>
				</div>

				<Separator />

				<div>
					<h4 className="text-base font-medium mb-1 flex items-center gap-2">
						<UsersIcon className="size-4" />
						<Trans>Alert recipients</Trans>
					</h4>
					<p className="text-sm text-muted-foreground mb-3">
						<Trans>
							Pick users from the list and/or add extra email addresses below. When the combined list is non-empty,
							all alert emails go there and per-user notification email lists are bypassed.
						</Trans>
					</p>

					<Label className="text-xs text-muted-foreground mb-1.5 block">
						<Trans>Users</Trans>
					</Label>
					{users.length === 0 ? (
						<p className="text-sm text-muted-foreground italic">
							<Trans>No users found.</Trans>
						</p>
					) : (
						<div className="rounded-md border divide-y">
							{users.map((u) => {
								const checked = (cfg.alertRecipientUserIds ?? []).includes(u.id)
								return (
									<label
										key={u.id}
										htmlFor={`recipient-${u.id}`}
										className={`flex items-center gap-3 px-3 py-2 ${locked ? "cursor-default" : "cursor-pointer hover:bg-muted/40"}`}
									>
										<Checkbox
											id={`recipient-${u.id}`}
											checked={checked}
											disabled={locked}
											onCheckedChange={(v) => toggleRecipient(u.id, v === true)}
										/>
										<div className="flex-1 min-w-0">
											<div className="text-sm font-medium truncate">{u.name || u.email}</div>
											<div className="text-xs text-muted-foreground truncate">
												{u.email}
												{u.role ? ` · ${u.role}` : ""}
											</div>
										</div>
									</label>
								)
							})}
						</div>
					)}

					<Label className="text-xs text-muted-foreground mt-4 mb-1.5 block">
						<Trans>Additional emails</Trans>
					</Label>
					<div className="rounded-md border p-2 space-y-2">
						{(cfg.alertRecipientEmails ?? []).length > 0 && (
							<div className="flex flex-wrap gap-1.5">
								{(cfg.alertRecipientEmails ?? []).map((addr) => (
									<span
										key={addr}
										className="inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-1 text-xs"
									>
										{addr}
										<button
											type="button"
											aria-label={t`Remove ${addr}`}
											disabled={locked}
											onClick={() => removeEmailChip(addr)}
											className="text-muted-foreground hover:text-foreground disabled:opacity-50"
										>
											<XIcon className="size-3" />
										</button>
									</span>
								))}
							</div>
						)}
						<div className="flex items-center gap-2">
							<Input
								type="email"
								placeholder={t`Type an email and press Enter`}
								value={emailDraft}
								disabled={locked}
								onChange={(e) => setEmailDraft(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" || e.key === "," || e.key === "Tab") {
										if (emailDraft.trim()) {
											e.preventDefault()
											addEmailChip()
										}
									}
								}}
							/>
							<Button
								type="button"
								variant="outline"
								size="sm"
								disabled={locked || !emailDraft.trim()}
								onClick={addEmailChip}
								className="gap-1"
							>
								<PlusIcon className="size-4" />
								<Trans>Add</Trans>
							</Button>
						</div>
					</div>
				</div>

				<Separator />

				<div>
					<h4 className="text-base font-medium mb-1 flex items-center gap-2">
						<ClockIcon className="size-4" />
						<Trans>Daily digest</Trans>
					</h4>
					<p className="text-sm text-muted-foreground mb-3">
						<Trans>
							Send one summary email per day listing every system with currently active alerts. Quiet days send
							nothing. Goes to the same recipient list above.
						</Trans>
					</p>
					<div className="flex items-center justify-between gap-4 rounded-md border p-4">
						<div>
							<Label htmlFor="digest-enabled" className="text-sm font-medium">
								<Trans>Enable daily digest</Trans>
							</Label>
							<p className="text-xs text-muted-foreground">
								<Trans>Includes temperature, CPU, memory, disk, GPU, status, battery, and bandwidth alerts.</Trans>
							</p>
						</div>
						<Switch
							id="digest-enabled"
							checked={cfg.dailyDigestEnabled}
							disabled={locked}
							onCheckedChange={(v) => setCfg({ ...cfg, dailyDigestEnabled: v })}
						/>
					</div>
					<div className="grid gap-1.5 mt-3 max-w-xs">
						<Label htmlFor="digest-hour">
							<Trans>Send at hour (server local time, 0–23)</Trans>
						</Label>
						<Select
							value={String(cfg.dailyDigestHour)}
							disabled={locked || !cfg.dailyDigestEnabled}
							onValueChange={(v) => setCfg({ ...cfg, dailyDigestHour: parseInt(v, 10) })}
						>
							<SelectTrigger id="digest-hour">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{Array.from({ length: 24 }, (_, h) => (
									<SelectItem key={h} value={String(h)}>
										{`${String(h).padStart(2, "0")}:00`}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>
				</div>

				<Separator />

				<div className="flex flex-wrap items-end gap-3">
					<Button type="submit" disabled={saving || locked} className="gap-1.5">
						{saving ? <Loader2Icon className="size-4 animate-spin" /> : <SaveIcon className="size-4" />}
						<Trans>Save settings</Trans>
					</Button>
					<div className="flex items-end gap-2 ms-auto">
						<div className="grid gap-1.5">
							<Label htmlFor="smtp-test-to" className="text-xs">
								<Trans>Send test email to</Trans>
							</Label>
							<Input
								id="smtp-test-to"
								type="email"
								className="w-64"
								value={testTo}
								onChange={(e) => setTestTo(e.target.value)}
							/>
						</div>
						<Button
							type="button"
							variant="outline"
							onClick={handleTest}
							disabled={testing || !cfg.enabled || !testTo}
							className="gap-1.5"
						>
							{testing ? <Loader2Icon className="size-4 animate-spin" /> : <SendIcon className="size-4" />}
							<Trans>Send test</Trans>
						</Button>
					</div>
				</div>

				{!cfg.enabled && (
					<p className="text-sm text-muted-foreground flex items-center gap-2">
						<MailIcon className="size-4" />
						<Trans>Email sending is currently disabled — enable it above to send tests or alerts.</Trans>
					</p>
				)}
			</form>
		</div>
	)
}
