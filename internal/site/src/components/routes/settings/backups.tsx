import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { redirectPage } from "@nanostores/router"
import { DatabaseBackupIcon, DownloadIcon, Loader2Icon, PlayIcon, RotateCcwIcon, Trash2Icon } from "lucide-react"
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
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/use-toast"
import { isAdmin, pb } from "@/lib/api"
import { prependBasePath } from "@/components/router"

type Backup = { key: string; size: number; modified: string }

function formatBytes(b: number) {
	if (b < 1024) return `${b} B`
	if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
	if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`
	return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatRelative(iso: string) {
	const t = new Date(iso).getTime()
	if (Number.isNaN(t)) return iso
	return new Date(t).toLocaleString()
}

function showApiError(err: unknown, fallback: string) {
	const e = err as { message?: string; data?: { message?: string } }
	toast({ title: t`Error`, description: e?.data?.message || e?.message || fallback, variant: "destructive" })
}

export default function BackupsSettings() {
	if (!isAdmin()) {
		redirectPage($router, "settings", { name: "general" })
	}
	const [backups, setBackups] = useState<Backup[] | null>(null)
	const [creating, setCreating] = useState(false)
	const [restoring, setRestoring] = useState<Backup | null>(null)
	const [deleting, setDeleting] = useState<Backup | null>(null)

	async function refresh() {
		try {
			const res = await pb.send<{ items: Backup[] }>("/api/bantay/admin/backups", {})
			res.items.sort((a, b) => (a.modified < b.modified ? 1 : -1))
			setBackups(res.items)
		} catch (err) {
			showApiError(err, t`Failed to load backups.`)
			setBackups([])
		}
	}

	useEffect(() => {
		refresh()
	}, [])

	async function handleBackupNow() {
		setCreating(true)
		try {
			await pb.send("/api/bantay/admin/backups", { method: "POST", body: {} })
			toast({ title: t`Backup created`, description: t`The new backup is now in the list.` })
			await refresh()
		} catch (err) {
			showApiError(err, t`Failed to create backup.`)
		} finally {
			setCreating(false)
		}
	}

	return (
		<div>
			<div className="flex items-start justify-between gap-3">
				<div>
					<h3 className="text-xl font-medium mb-2">
						<Trans>Backups</Trans>
					</h3>
					<p className="text-sm text-muted-foreground leading-relaxed">
						<Trans>
							Snapshots of all your data: users, systems, alerts, history. Take one before any risky change. Restore puts
							your hub back the way it was when the backup was taken.
						</Trans>
					</p>
				</div>
				<Button onClick={handleBackupNow} disabled={creating} className="gap-1.5 shrink-0">
					{creating ? <Loader2Icon className="size-4 animate-spin" /> : <PlayIcon className="size-4" />}
					<Trans>Backup now</Trans>
				</Button>
			</div>
			<Separator className="my-4" />

			{backups === null ? (
				<div className="py-10 grid place-items-center text-muted-foreground">
					<Loader2Icon className="size-5 animate-spin" />
				</div>
			) : backups.length === 0 ? (
				<div className="py-10 grid place-items-center text-muted-foreground gap-2">
					<DatabaseBackupIcon className="size-8" />
					<p>
						<Trans>No backups yet. Click "Backup now" to create your first one.</Trans>
					</p>
				</div>
			) : (
				<div className="rounded-md border overflow-x-auto">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>
									<Trans>File</Trans>
								</TableHead>
								<TableHead>
									<Trans>When</Trans>
								</TableHead>
								<TableHead>
									<Trans>Size</Trans>
								</TableHead>
								<TableHead className="text-right">
									<Trans>Actions</Trans>
								</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{backups.map((b) => (
								<TableRow key={b.key}>
									<TableCell className="font-mono text-xs">{b.key}</TableCell>
									<TableCell>{formatRelative(b.modified)}</TableCell>
									<TableCell>{formatBytes(b.size)}</TableCell>
									<TableCell className="text-right">
										<div className="flex justify-end gap-1">
											<Button
												asChild
												size="icon"
												variant="ghost"
												title={t`Download backup`}
											>
												<a
													href={prependBasePath(`/api/backups/${encodeURIComponent(b.key)}`)}
													download
												>
													<DownloadIcon className="size-4" />
												</a>
											</Button>
											<Button
												size="icon"
												variant="ghost"
												title={t`Restore from this backup`}
												onClick={() => setRestoring(b)}
											>
												<RotateCcwIcon className="size-4" />
											</Button>
											<Button
												size="icon"
												variant="ghost"
												title={t`Delete backup`}
												onClick={() => setDeleting(b)}
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

			{restoring && (
				<RestoreDialog
					backup={restoring}
					onClose={() => setRestoring(null)}
					onDone={() => {
						setRestoring(null)
						refresh()
					}}
				/>
			)}
			{deleting && (
				<DeleteDialog
					backup={deleting}
					onClose={() => setDeleting(null)}
					onDone={() => {
						setDeleting(null)
						refresh()
					}}
				/>
			)}
		</div>
	)
}

function RestoreDialog({ backup, onClose, onDone }: { backup: Backup; onClose: () => void; onDone: () => void }) {
	const [busy, setBusy] = useState(false)
	async function confirm() {
		setBusy(true)
		try {
			await pb.send(`/api/bantay/admin/backups/${encodeURIComponent(backup.key)}/restore`, { method: "POST" })
			toast({
				title: t`Restoring`,
				description: t`The hub will restart in a moment. Refresh the page after about 30 seconds.`,
			})
			onDone()
		} catch (err) {
			showApiError(err, t`Failed to restore backup.`)
			setBusy(false)
		}
	}
	return (
		<AlertDialog open onOpenChange={(o) => !o && onClose()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						<Trans>Restore from this backup?</Trans>
					</AlertDialogTitle>
					<AlertDialogDescription>
						<Trans>
							This replaces all current data with the contents of <strong>{backup.key}</strong>. The hub will restart.
							Anything added since this backup was taken will be lost.
						</Trans>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={busy}>
						<Trans>Cancel</Trans>
					</AlertDialogCancel>
					<AlertDialogAction onClick={confirm} disabled={busy} className="bg-destructive hover:bg-destructive/90">
						{busy && <Loader2Icon className="size-4 animate-spin me-1.5" />}
						<Trans>Restore</Trans>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}

function DeleteDialog({ backup, onClose, onDone }: { backup: Backup; onClose: () => void; onDone: () => void }) {
	const [busy, setBusy] = useState(false)
	async function confirm() {
		setBusy(true)
		try {
			await pb.send(`/api/bantay/admin/backups/${encodeURIComponent(backup.key)}`, { method: "DELETE" })
			toast({ title: t`Backup deleted`, description: backup.key })
			onDone()
		} catch (err) {
			showApiError(err, t`Failed to delete backup.`)
			setBusy(false)
		}
	}
	return (
		<AlertDialog open onOpenChange={(o) => !o && onClose()}>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						<Trans>Delete this backup?</Trans>
					</AlertDialogTitle>
					<AlertDialogDescription>
						<Trans>
							The file <strong>{backup.key}</strong> will be permanently removed. This does not affect your live data.
						</Trans>
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={busy}>
						<Trans>Cancel</Trans>
					</AlertDialogCancel>
					<AlertDialogAction onClick={confirm} disabled={busy} className="bg-destructive hover:bg-destructive/90">
						{busy && <Loader2Icon className="size-4 animate-spin me-1.5" />}
						<Trans>Delete</Trans>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	)
}
