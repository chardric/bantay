import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { redirectPage } from "@nanostores/router"
import { Loader2Icon, LockIcon, MailIcon, SaveIcon, SendIcon, UnlockIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { $router } from "@/components/router"
import { Button } from "@/components/ui/button"
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
	const [password, setPassword] = useState("")
	const [saving, setSaving] = useState(false)
	const [testing, setTesting] = useState(false)
	const [testTo, setTestTo] = useState("")
	const [locked, setLocked] = useState(true)

	async function load() {
		try {
			const res = await pb.send<SmtpConfig>("/api/bantay/admin/settings/smtp", {})
			setCfg(res)
			setTestTo(pb.authStore.record?.email ?? "")
		} catch (err) {
			showApiError(err, t`Failed to load SMTP settings.`)
		}
	}

	useEffect(() => {
		load()
	}, [])

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
