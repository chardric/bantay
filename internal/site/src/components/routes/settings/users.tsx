import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { redirectPage } from "@nanostores/router"
import { KeyIcon, Loader2Icon, MailIcon, PencilIcon, PlusIcon, Trash2Icon, UserIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { $router } from "@/components/router"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/use-toast"
import { isAdmin, pb } from "@/lib/api"

type AdminUser = {
	id: string
	email: string
	name: string
	role: string
	verified: boolean
	created: string
}

const roleLabel = (role: string) => {
	if (role === "admin") return t`Admin`
	if (role === "readonly") return t`Read only`
	return t`Regular`
}

const roleBadgeVariant = (role: string): "default" | "secondary" | "outline" => {
	if (role === "admin") return "default"
	if (role === "readonly") return "outline"
	return "secondary"
}

function showApiError(err: unknown, fallback: string) {
	const e = err as { message?: string; data?: { message?: string } }
	const description = e?.data?.message || e?.message || fallback
	toast({ title: t`Error`, description, variant: "destructive" })
}

export default function UsersSettings() {
	if (!isAdmin()) {
		redirectPage($router, "settings", { name: "general" })
	}
	const [users, setUsers] = useState<AdminUser[] | null>(null)
	const [editing, setEditing] = useState<AdminUser | null>(null)
	const [creating, setCreating] = useState(false)
	const [deleting, setDeleting] = useState<AdminUser | null>(null)

	async function refresh() {
		try {
			const res = await pb.send<{ items: AdminUser[] }>("/api/bantay/admin/users", {})
			setUsers(res.items)
		} catch (err) {
			showApiError(err, t`Failed to load users.`)
			setUsers([])
		}
	}

	useEffect(() => {
		refresh()
	}, [])

	async function handleResetPassword(u: AdminUser) {
		try {
			await pb.send(`/api/bantay/admin/users/${u.id}/reset-password`, { method: "POST" })
			toast({ title: t`Password reset email sent`, description: u.email })
		} catch (err) {
			showApiError(err, t`Failed to send password reset.`)
		}
	}

	return (
		<div>
			<div className="flex items-start justify-between gap-3">
				<div>
					<h3 className="text-xl font-medium mb-2">
						<Trans>Users</Trans>
					</h3>
					<p className="text-sm text-muted-foreground leading-relaxed">
						<Trans>Add people who can sign in. Admins can change settings; read-only users can view but not edit.</Trans>
					</p>
				</div>
				<Button onClick={() => setCreating(true)} className="gap-1.5 shrink-0">
					<PlusIcon className="size-4" />
					<Trans>Add user</Trans>
				</Button>
			</div>
			<Separator className="my-4" />

			{users === null ? (
				<div className="py-10 grid place-items-center text-muted-foreground">
					<Loader2Icon className="size-5 animate-spin" />
				</div>
			) : users.length === 0 ? (
				<div className="py-10 grid place-items-center text-muted-foreground gap-2">
					<UserIcon className="size-8" />
					<p>
						<Trans>No users yet.</Trans>
					</p>
				</div>
			) : (
				<div className="rounded-md border overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>
									<Trans>Email</Trans>
								</TableHead>
								<TableHead>
									<Trans>Name</Trans>
								</TableHead>
								<TableHead>
									<Trans>Role</Trans>
								</TableHead>
								<TableHead className="text-right">
									<Trans>Actions</Trans>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{users.map((u) => (
								<TableRow key={u.id}>
									<TableCell className="font-medium">{u.email}</TableCell>
									<TableCell>{u.name || "—"}</TableCell>
									<TableCell>
										<Badge variant={roleBadgeVariant(u.role)}>{roleLabel(u.role)}</Badge>
									</TableCell>
									<TableCell className="text-right">
										<div className="flex justify-end gap-1">
											<Button
												size="icon"
												variant="ghost"
												title={t`Send password reset email`}
												onClick={() => handleResetPassword(u)}
											>
												<MailIcon className="size-4" />
											</Button>
											<Button size="icon" variant="ghost" title={t`Edit user`} onClick={() => setEditing(u)}>
												<PencilIcon className="size-4" />
											</Button>
											<Button
												size="icon"
												variant="ghost"
												title={t`Delete user`}
												onClick={() => setDeleting(u)}
												disabled={u.id === pb.authStore.record?.id}
											>
												<Trash2Icon className="size-4" />
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			{creating && <CreateDialog onClose={() => setCreating(false)} onSaved={refresh} />}
			{editing && <EditDialog user={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
			{deleting && (
				<DeleteDialog
					user={deleting}
					onClose={() => setDeleting(null)}
					onDeleted={() => {
						setDeleting(null)
						refresh()
					}}
				/>
			)}
		</div>
	)
}

function CreateDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
	const [email, setEmail] = useState("")
	const [password, setPassword] = useState("")
	const [name, setName] = useState("")
	const [role, setRole] = useState("")
	const [saving, setSaving] = useState(false)

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		setSaving(true)
		try {
			await pb.send("/api/bantay/admin/users", {
				method: "POST",
				body: { email, password, name, role },
			})
			toast({ title: t`User created`, description: email })
			onSaved()
			onClose()
		} catch (err) {
			showApiError(err, t`Failed to create user.`)
		} finally {
			setSaving(false)
		}
	}

	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						<Trans>Add a new user</Trans>
					</DialogTitle>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="grid gap-4 mt-2">
					<div className="grid gap-1.5">
						<Label htmlFor="new-email">
							<Trans>Email</Trans>
						</Label>
						<Input
							id="new-email"
							type="email"
							required
							autoComplete="off"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
						/>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="new-name">
							<Trans>Name (optional)</Trans>
						</Label>
						<Input id="new-name" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="new-password">
							<Trans>Password</Trans>
						</Label>
						<Input
							id="new-password"
							type="password"
							required
							minLength={8}
							autoComplete="new-password"
							value={password}
							onChange={(e) => setPassword(e.target.value)}
						/>
						<p className="text-xs text-muted-foreground">
							<Trans>At least 8 characters.</Trans>
						</p>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="new-role">
							<Trans>Role</Trans>
						</Label>
						<Select value={role || "regular"} onValueChange={(v) => setRole(v === "regular" ? "" : v)}>
							<SelectTrigger id="new-role">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="regular">
									<Trans>Regular — manage own systems</Trans>
								</SelectItem>
								<SelectItem value="admin">
									<Trans>Admin — full access</Trans>
								</SelectItem>
								<SelectItem value="readonly">
									<Trans>Read only — view only, cannot edit</Trans>
								</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<DialogFooter className="gap-2">
						<Button type="button" variant="outline" onClick={onClose}>
							<Trans>Cancel</Trans>
						</Button>
						<Button type="submit" disabled={saving}>
							{saving && <Loader2Icon className="size-4 animate-spin me-1.5" />}
							<Trans>Create user</Trans>
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

function EditDialog({ user, onClose, onSaved }: { user: AdminUser; onClose: () => void; onSaved: () => void }) {
	const [name, setName] = useState(user.name)
	const [role, setRole] = useState(user.role)
	const [password, setPassword] = useState("")
	const [saving, setSaving] = useState(false)
	const isSelf = user.id === pb.authStore.record?.id

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		setSaving(true)
		const body: Record<string, unknown> = { name }
		if (!isSelf) body.role = role
		if (password) body.password = password
		try {
			await pb.send(`/api/bantay/admin/users/${user.id}`, { method: "PATCH", body })
			// PocketBase rotates the user's tokenKey on password change, invalidating
			// the current session. If we just changed our own password, re-auth with
			// the new password to keep the session alive.
			if (isSelf && password) {
				try {
					await pb.collection("users").authWithPassword(user.email, password)
				} catch {
					toast({
						title: t`Password updated`,
						description: t`Please sign in again with your new password.`,
					})
					pb.authStore.clear()
					window.location.reload()
					return
				}
			}
			toast({ title: t`User updated`, description: user.email })
			onSaved()
			onClose()
		} catch (err) {
			showApiError(err, t`Failed to update user.`)
		} finally {
			setSaving(false)
		}
	}

	return (
		<Dialog open onOpenChange={(o) => !o && onClose()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						<Trans>Edit user</Trans>
					</DialogTitle>
				</DialogHeader>
				<form onSubmit={handleSubmit} className="grid gap-4 mt-2">
					<div className="grid gap-1.5">
						<Label>
							<Trans>Email</Trans>
						</Label>
						<Input value={user.email} disabled />
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="edit-name">
							<Trans>Name</Trans>
						</Label>
						<Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} />
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="edit-role">
							<Trans>Role</Trans>
						</Label>
						<Select
							value={role || "regular"}
							onValueChange={(v) => setRole(v === "regular" ? "" : v)}
							disabled={isSelf}
						>
							<SelectTrigger id="edit-role">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="regular">
									<Trans>Regular</Trans>
								</SelectItem>
								<SelectItem value="admin">
									<Trans>Admin</Trans>
								</SelectItem>
								<SelectItem value="readonly">
									<Trans>Read only</Trans>
								</SelectItem>
							</SelectContent>
						</Select>
						{isSelf && (
							<p className="text-xs text-muted-foreground">
								<Trans>You cannot change your own role. Ask another admin.</Trans>
							</p>
						)}
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="edit-password">
							<Trans>New password (optional)</Trans>
						</Label>
						<Input
							id="edit-password"
							type="password"
							minLength={8}
							autoComplete="new-password"
							placeholder={t`Leave blank to keep current`}
							value={password}
							onChange={(e) => setPassword(e.target.value)}
						/>
					</div>
					<DialogFooter className="gap-2">
						<Button type="button" variant="outline" onClick={onClose}>
							<Trans>Cancel</Trans>
						</Button>
						<Button type="submit" disabled={saving}>
							{saving && <Loader2Icon className="size-4 animate-spin me-1.5" />}
							<KeyIcon className="size-4 me-1.5" />
							<Trans>Save changes</Trans>
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}

function DeleteDialog({
	user,
	onClose,
	onDeleted,
}: {
	user: AdminUser
	onClose: () => void
	onDeleted: () => void
}) {
	const [busy, setBusy] = useState(false)
	async function confirm() {
		setBusy(true)
		try {
			await pb.send(`/api/bantay/admin/users/${user.id}`, { method: "DELETE" })
			toast({ title: t`User deleted`, description: user.email })
			onDeleted()
		} catch (err) {
			showApiError(err, t`Failed to delete user.`)
			setBusy(false)
		}
	}
	return (
		<AlertDialog open onOpenChange={(o) => !o && onClose()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						<Trans>Delete this user?</Trans>
					</AlertDialogTitle>
					<AlertDialogDescription>
						<Trans>
							This permanently removes <strong>{user.email}</strong> and any systems they own. This cannot be undone.
						</Trans>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={busy}>
						<Trans>Cancel</Trans>
					</AlertDialogCancel>
					<AlertDialogAction onClick={confirm} disabled={busy} className="bg-destructive hover:bg-destructive/90">
						{busy && <Loader2Icon className="size-4 animate-spin me-1.5" />}
						<Trans>Delete user</Trans>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
