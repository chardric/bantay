import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { redirectPage } from "@nanostores/router"
import {
	ChevronDownIcon,
	ChevronRightIcon,
	Loader2Icon,
	RefreshCcwIcon,
	SearchIcon,
	Trash2Icon,
} from "lucide-react"
import { Fragment, useEffect, useState } from "react"
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
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { toast } from "@/components/ui/use-toast"
import { isAdmin, pb } from "@/lib/api"
import { cn } from "@/lib/utils"

type LogEntry = {
	id: string
	level: number
	message: string
	created: string
	data?: Record<string, unknown>
}

const LEVEL_INFO = 0
const LEVEL_WARN = 4
const LEVEL_ERROR = 8

function levelLabel(l: number) {
	if (l >= LEVEL_ERROR) return t`Error`
	if (l >= LEVEL_WARN) return t`Warning`
	return t`Info`
}

function levelVariant(l: number): "default" | "destructive" | "outline" | "secondary" {
	if (l >= LEVEL_ERROR) return "destructive"
	if (l >= LEVEL_WARN) return "default"
	return "secondary"
}

function statusVariant(status: number): "default" | "destructive" | "outline" | "secondary" {
	if (status >= 500) return "destructive"
	if (status >= 400) return "default"
	if (status >= 300) return "outline"
	if (status >= 200) return "secondary"
	return "outline"
}

function getStr(d: Record<string, unknown> | undefined, k: string): string {
	const v = d?.[k]
	return typeof v === "string" ? v : ""
}

function getNum(d: Record<string, unknown> | undefined, k: string): number | null {
	const v = d?.[k]
	return typeof v === "number" ? v : null
}

function showApiError(err: unknown, fallback: string) {
	const e = err as { message?: string; data?: { message?: string } }
	toast({ title: t`Error`, description: e?.data?.message || e?.message || fallback, variant: "destructive" })
}

function isRequestLog(data?: Record<string, unknown>) {
	return getStr(data, "type") === "request"
}

function MessageCell({ entry }: { entry: LogEntry }) {
	const d = entry.data
	if (isRequestLog(d)) {
		const method = getStr(d, "method")
		const url = getStr(d, "url")
		const status = getNum(d, "status") ?? 0
		const errMsg = getStr(d, "error")
		return (
			<div className="space-y-0.5 min-w-0">
				<div className="flex items-center gap-2 flex-wrap">
					<Badge variant={statusVariant(status)} className="font-mono">
						{status || "?"}
					</Badge>
					<span className="font-mono text-xs font-medium">{method}</span>
					<span className="font-mono text-xs text-muted-foreground break-all">{url}</span>
				</div>
				{errMsg && <div className="text-xs text-destructive">{errMsg}</div>}
			</div>
		)
	}
	// Non-request entries: show message + any obvious system context inline.
	const sysName = getStr(d, "name") || getStr(d, "system")
	return (
		<div className="space-y-0.5 min-w-0">
			<div className="text-sm break-words">{entry.message || "(no message)"}</div>
			{sysName && (
				<div className="text-xs text-muted-foreground">
					<Trans>System:</Trans> <span className="font-mono">{sysName}</span>
				</div>
			)}
		</div>
	)
}

function DetailsRow({ entry }: { entry: LogEntry }) {
	const d = entry.data ?? {}
	const isReq = isRequestLog(d)
	const fields: Array<[string, string]> = []

	if (isReq) {
		const auth = getStr(d, "auth") || "guest"
		const ip = getStr(d, "userIP") || getStr(d, "remoteIP")
		const ref = getStr(d, "referer")
		const ua = getStr(d, "userAgent")
		const exec = getNum(d, "execTime")
		fields.push([t`Authenticated as`, auth || t`Anonymous (no login)`])
		if (ip) fields.push([t`Client IP`, ip])
		if (exec !== null) fields.push([t`Took`, `${exec.toFixed(1)} ms`])
		if (ref) fields.push([t`Came from`, ref])
		if (ua) fields.push([t`Browser / agent`, ua])
		const errDetails = d.details
		if (errDetails && typeof errDetails === "object" && Object.keys(errDetails).length > 0) {
			fields.push([t`Error details`, JSON.stringify(errDetails)])
		}
	} else {
		// Show every primitive value of data as a friendly key/value row.
		for (const [k, v] of Object.entries(d)) {
			if (v === null || v === undefined || v === "") continue
			if (typeof v === "object") {
				fields.push([k, JSON.stringify(v)])
			} else {
				fields.push([k, String(v)])
			}
		}
	}

	if (fields.length === 0) {
		return (
			<div className="text-xs text-muted-foreground italic">
				<Trans>No additional details for this entry.</Trans>
			</div>
		)
	}

	return (
		<dl className="grid sm:grid-cols-[max-content_1fr] gap-x-3 gap-y-1.5 text-xs">
			{fields.map(([k, v]) => (
				<div key={k} className="contents">
					<dt className="text-muted-foreground capitalize">{k}</dt>
					<dd className="font-mono break-all">{v}</dd>
				</div>
			))}
		</dl>
	)
}

export default function LogsSettings() {
	if (!isAdmin()) {
		redirectPage($router, "settings", { name: "general" })
	}
	const [logs, setLogs] = useState<LogEntry[] | null>(null)
	const [page, setPage] = useState(1)
	const [perPage] = useState(50)
	const [level, setLevel] = useState<string>("any")
	const [query, setQuery] = useState("")
	const [searchInput, setSearchInput] = useState("")
	const [confirmClear, setConfirmClear] = useState(false)
	const [loading, setLoading] = useState(false)
	const [expanded, setExpanded] = useState<Set<string>>(new Set())

	function toggleExpanded(id: string) {
		setExpanded((prev) => {
			const next = new Set(prev)
			if (next.has(id)) next.delete(id)
			else next.add(id)
			return next
		})
	}

	async function refresh() {
		setLoading(true)
		try {
			const params = new URLSearchParams()
			params.set("page", String(page))
			params.set("perPage", String(perPage))
			if (level !== "any") params.set("level", level)
			if (query) params.set("q", query)
			const res = await pb.send<{ items: LogEntry[] }>(`/api/bantay/admin/logs?${params}`, {})
			setLogs(res.items)
		} catch (err) {
			showApiError(err, t`Failed to load logs.`)
			setLogs([])
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		refresh()
	}, [page, level, query])

	async function handleClear() {
		try {
			await pb.send("/api/bantay/admin/logs", { method: "DELETE" })
			toast({ title: t`Logs cleared` })
			setConfirmClear(false)
			setPage(1)
			refresh()
		} catch (err) {
			showApiError(err, t`Failed to clear logs.`)
		}
	}

	function handleSearchSubmit(e: React.FormEvent) {
		e.preventDefault()
		setPage(1)
		setQuery(searchInput.trim())
	}

	return (
		<div>
			<div className="flex items-start justify-between gap-3 flex-wrap">
				<div>
					<h3 className="text-xl font-medium mb-2">
						<Trans>Activity log</Trans>
					</h3>
					<p className="text-sm text-muted-foreground leading-relaxed">
						<Trans>
							What happened recently inside Bantay — useful when something looks wrong or an alert didn't fire. Click a
							row to see full details.
						</Trans>
					</p>
				</div>
				<div className="flex gap-2 shrink-0">
					<Button variant="outline" onClick={refresh} disabled={loading} className="gap-1.5">
						<RefreshCcwIcon className={`size-4 ${loading ? "animate-spin" : ""}`} />
						<Trans>Refresh</Trans>
					</Button>
					<Button variant="outline" onClick={() => setConfirmClear(true)} className="gap-1.5">
						<Trash2Icon className="size-4" />
						<Trans>Clear all</Trans>
					</Button>
				</div>
			</div>
			<Separator className="my-4" />

			<div className="flex flex-wrap gap-3 mb-4">
				<form onSubmit={handleSearchSubmit} className="flex gap-2 flex-1 min-w-64">
					<div className="relative flex-1">
						<SearchIcon className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
						<Input
							placeholder={t`Search messages...`}
							className="ps-9"
							value={searchInput}
							onChange={(e) => setSearchInput(e.target.value)}
						/>
					</div>
					<Button type="submit" variant="outline">
						<Trans>Search</Trans>
					</Button>
				</form>
				<Select
					value={level}
					onValueChange={(v) => {
						setPage(1)
						setLevel(v)
					}}
				>
					<SelectTrigger className="w-44">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="any">
							<Trans>All levels</Trans>
						</SelectItem>
						<SelectItem value="0">
							<Trans>Info only</Trans>
						</SelectItem>
						<SelectItem value="4">
							<Trans>Warnings only</Trans>
						</SelectItem>
						<SelectItem value="8">
							<Trans>Errors only</Trans>
						</SelectItem>
					</SelectContent>
				</Select>
			</div>

			{logs === null ? (
				<div className="py-10 grid place-items-center text-muted-foreground">
					<Loader2Icon className="size-5 animate-spin" />
				</div>
			) : logs.length === 0 ? (
				<div className="py-10 grid place-items-center text-muted-foreground">
					<p>
						<Trans>No log entries match your filters.</Trans>
					</p>
				</div>
			) : (
				<>
					<div className="rounded-md border overflow-x-auto">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-8" />
									<TableHead className="w-44">
										<Trans>When</Trans>
									</TableHead>
									<TableHead className="w-24">
										<Trans>Level</Trans>
									</TableHead>
									<TableHead>
										<Trans>What happened</Trans>
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{logs.map((l) => {
									const isOpen = expanded.has(l.id)
									return (
										<Fragment key={l.id}>
											<TableRow
												className="cursor-pointer"
												onClick={() => toggleExpanded(l.id)}
											>
												<TableCell className="align-top">
													{isOpen ? (
														<ChevronDownIcon className="size-4 text-muted-foreground" />
													) : (
														<ChevronRightIcon className="size-4 text-muted-foreground" />
													)}
												</TableCell>
												<TableCell className="text-xs whitespace-nowrap text-muted-foreground align-top">
													{new Date(l.created).toLocaleString()}
												</TableCell>
												<TableCell className="align-top">
													<Badge variant={levelVariant(l.level)}>{levelLabel(l.level)}</Badge>
												</TableCell>
												<TableCell className="align-top">
													<MessageCell entry={l} />
												</TableCell>
											</TableRow>
											{isOpen && (
												<TableRow className={cn("hover:bg-transparent bg-muted/30")}>
													<TableCell />
													<TableCell colSpan={3} className="py-3">
														<DetailsRow entry={l} />
													</TableCell>
												</TableRow>
											)}
										</Fragment>
									)
								})}
							</TableBody>
						</Table>
					</div>
					<div className="flex justify-between items-center mt-4 text-sm">
						<p className="text-muted-foreground">
							<Trans>Page {page}</Trans>
						</p>
						<div className="flex gap-2">
							<Button
								variant="outline"
								size="sm"
								disabled={page <= 1 || loading}
								onClick={() => setPage(page - 1)}
							>
								<Trans>Previous</Trans>
							</Button>
							<Button
								variant="outline"
								size="sm"
								disabled={logs.length < perPage || loading}
								onClick={() => setPage(page + 1)}
							>
								<Trans>Next</Trans>
							</Button>
						</div>
					</div>
				</>
			)}

			<AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							<Trans>Clear all log entries?</Trans>
						</AlertDialogTitle>
						<AlertDialogDescription>
							<Trans>This permanently deletes every entry in the activity log. This cannot be undone.</Trans>
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>
							<Trans>Cancel</Trans>
						</AlertDialogCancel>
						<AlertDialogAction onClick={handleClear} className="bg-destructive hover:bg-destructive/90">
							<Trans>Clear logs</Trans>
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}
