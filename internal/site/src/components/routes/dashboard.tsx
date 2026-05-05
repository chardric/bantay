import { t } from "@lingui/core/macro"
import { Trans, useLingui } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { getPagePath } from "@nanostores/router"
import {
	ActivityIcon,
	AlertTriangleIcon,
	CircleCheckIcon,
	CircleSlashIcon,
	CpuIcon,
	HardDriveIcon,
	MemoryStickIcon,
	PauseIcon,
	ServerIcon,
} from "lucide-react"
import { memo, useEffect, useMemo } from "react"
import { ActiveAlerts } from "@/components/active-alerts"
import { FooterRepoLink } from "@/components/footer-repo-link"
import { $router, Link } from "@/components/router"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SystemStatus } from "@/lib/enums"
import {
	$allSystemsById,
	$downSystems,
	$pausedSystems,
	$systems,
	$upSystems,
} from "@/lib/stores"
import { cn, decimalString, secondsToUptimeString } from "@/lib/utils"
import type { SystemRecord } from "@/types"

const statusColor = (pct: number) => {
	if (pct >= 90) return "text-red-500"
	if (pct >= 75) return "text-amber-500"
	if (pct >= 50) return "text-yellow-600 dark:text-yellow-500"
	return "text-emerald-600 dark:text-emerald-500"
}

const meterColor = (pct: number) => {
	if (pct >= 90) return "bg-red-500"
	if (pct >= 75) return "bg-amber-500"
	if (pct >= 50) return "bg-yellow-500"
	return "bg-emerald-500"
}

function StatusTile({
	icon: Icon,
	label,
	count,
	tone,
	href,
}: {
	icon: React.ComponentType<{ className?: string }>
	label: string
	count: number
	tone: "default" | "ok" | "warn" | "muted"
	href: string
}) {
	const toneClass = {
		default: "text-foreground",
		ok: "text-emerald-600 dark:text-emerald-500",
		warn: "text-red-500",
		muted: "text-muted-foreground",
	}[tone]
	return (
		<Link
			href={href}
			className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
		>
			<Card className="hover:shadow-md transition-shadow h-full">
				<CardContent className="flex items-center gap-4 p-4 sm:p-5">
					<div className={cn("rounded-md p-2.5 bg-muted/50", toneClass)}>
						<Icon className="size-6" />
					</div>
					<div className="flex flex-col min-w-0">
						<span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
						<span className={cn("text-2xl font-semibold tabular-nums", toneClass)}>{count}</span>
					</div>
				</CardContent>
			</Card>
		</Link>
	)
}

function FleetGauge({
	icon: Icon,
	label,
	value,
	suffix,
}: {
	icon: React.ComponentType<{ className?: string }>
	label: string
	value: number
	suffix: string
}) {
	const pct = Math.max(0, Math.min(100, value))
	return (
		<Card>
			<CardContent className="p-4 sm:p-5">
				<div className="flex items-center gap-2 text-muted-foreground mb-2">
					<Icon className="size-4" />
					<span className="text-xs uppercase tracking-wider">{label}</span>
				</div>
				<div className={cn("text-2xl font-semibold tabular-nums mb-2", statusColor(pct))}>
					{decimalString(value, 1)}
					<span className="text-base font-normal text-muted-foreground ms-1">{suffix}</span>
				</div>
				<div className="w-full h-2 rounded-full bg-muted overflow-hidden">
					<div
						className={cn("h-full transition-[width] duration-500", meterColor(pct))}
						style={{ width: `${pct}%` }}
					/>
				</div>
			</CardContent>
		</Card>
	)
}

function TopConsumersCard({
	title,
	icon: Icon,
	systems,
	getValue,
	getDisplay,
}: {
	title: string
	icon: React.ComponentType<{ className?: string }>
	systems: SystemRecord[]
	getValue: (s: SystemRecord) => number
	getDisplay: (s: SystemRecord) => string
}) {
	const top = useMemo(() => {
		return [...systems]
			.filter((s) => s.status === SystemStatus.Up && Number.isFinite(getValue(s)))
			.sort((a, b) => getValue(b) - getValue(a))
			.slice(0, 5)
	}, [systems])

	return (
		<Card>
			<CardHeader className="pb-3">
				<CardTitle className="flex items-center gap-2 text-base">
					<Icon className="size-4 text-muted-foreground" />
					{title}
				</CardTitle>
			</CardHeader>
			<CardContent className="pt-0">
				{top.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						<Trans>No data yet.</Trans>
					</p>
				) : (
					<ul className="flex flex-col gap-2.5">
						{top.map((s) => {
							const v = getValue(s)
							const pct = Math.max(0, Math.min(100, v))
							return (
								<li key={s.id}>
									<Link
										href={getPagePath($router, "system", { id: s.id })}
										className="block group"
									>
										<div className="flex items-center justify-between text-sm mb-1">
											<span className="truncate font-medium group-hover:underline">{s.name}</span>
											<span className={cn("tabular-nums shrink-0 ms-3", statusColor(pct))}>
												{getDisplay(s)}
											</span>
										</div>
										<div className="w-full h-1.5 rounded-full bg-muted overflow-hidden">
											<div
												className={cn("h-full", meterColor(pct))}
												style={{ width: `${pct}%` }}
											/>
										</div>
									</Link>
								</li>
							)
						})}
					</ul>
				)}
			</CardContent>
		</Card>
	)
}

function FleetOverview({ systems }: { systems: SystemRecord[] }) {
	const upOnly = systems.filter((s) => s.status === SystemStatus.Up)
	const avg = (key: "cpu" | "mp" | "dp") => {
		if (upOnly.length === 0) return 0
		const sum = upOnly.reduce((acc, s) => acc + (s.info?.[key] ?? 0), 0)
		return sum / upOnly.length
	}
	return (
		<div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
			<FleetGauge icon={CpuIcon} label={t`Avg CPU`} value={avg("cpu")} suffix="%" />
			<FleetGauge icon={MemoryStickIcon} label={t`Avg Memory`} value={avg("mp")} suffix="%" />
			<FleetGauge icon={HardDriveIcon} label={t`Avg Disk`} value={avg("dp")} suffix="%" />
		</div>
	)
}

function RecentActivity({ systems }: { systems: SystemRecord[] }) {
	const tsOf = (iso: string | undefined) => {
		if (!iso) return 0
		const t = new Date(iso).getTime()
		return Number.isFinite(t) ? t : 0
	}

	const recent = useMemo(() => {
		return [...systems].sort((a, b) => tsOf(b.updated) - tsOf(a.updated)).slice(0, 6)
	}, [systems])

	const formatter = useMemo(
		() =>
			new Intl.RelativeTimeFormat(undefined, {
				numeric: "auto",
				style: "short",
			}),
		[]
	)

	const relativeTime = (iso: string | undefined) => {
		const ts = tsOf(iso)
		if (!ts) return ""
		const diffSec = Math.round((ts - Date.now()) / 1000)
		const absSec = Math.abs(diffSec)
		if (absSec < 60) return formatter.format(diffSec, "second")
		if (absSec < 3600) return formatter.format(Math.round(diffSec / 60), "minute")
		if (absSec < 86400) return formatter.format(Math.round(diffSec / 3600), "hour")
		return formatter.format(Math.round(diffSec / 86400), "day")
	}

	return (
		<Card>
			<CardHeader className="pb-3">
				<CardTitle className="flex items-center gap-2 text-base">
					<ActivityIcon className="size-4 text-muted-foreground" />
					<Trans>Recent activity</Trans>
				</CardTitle>
				<CardDescription>
					<Trans>Most recently reporting systems.</Trans>
				</CardDescription>
			</CardHeader>
			<CardContent className="pt-0">
				{recent.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						<Trans>No systems yet.</Trans>
					</p>
				) : (
					<ul className="flex flex-col divide-y divide-border/60">
						{recent.map((s) => (
							<li key={s.id}>
								<Link
									href={getPagePath($router, "system", { id: s.id })}
									className="flex items-center justify-between gap-3 py-2.5 hover:bg-muted/40 -mx-2 px-2 rounded transition-colors"
								>
									<div className="flex items-center gap-3 min-w-0">
										<span
											className={cn(
												"size-2 shrink-0 rounded-full",
												s.status === SystemStatus.Up
													? "bg-emerald-500"
													: s.status === SystemStatus.Down
														? "bg-red-500"
														: "bg-muted-foreground/50"
											)}
											aria-label={s.status}
										/>
										<span className="truncate font-medium">{s.name}</span>
										{s.info?.u > 0 && s.status === SystemStatus.Up && (
											<span className="text-xs text-muted-foreground hidden sm:inline truncate">
												{t`up`} {secondsToUptimeString(s.info.u)}
											</span>
										)}
									</div>
									<span className="text-xs text-muted-foreground tabular-nums shrink-0">
										{relativeTime(s.updated)}
									</span>
								</Link>
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	)
}

export default memo(() => {
	const systems = useStore($systems)
	const upSystems = useStore($upSystems)
	const downSystems = useStore($downSystems)
	const pausedSystems = useStore($pausedSystems)
	const allById = useStore($allSystemsById)
	const { t: tx } = useLingui()

	useEffect(() => {
		document.title = `${tx`Dashboard`} / Bantay`
	}, [tx])

	const counts = useMemo(
		() => ({
			total: Object.keys(allById).length,
			up: Object.keys(upSystems).length,
			down: Object.keys(downSystems).length,
			paused: Object.keys(pausedSystems).length,
		}),
		[allById, upSystems, downSystems, pausedSystems]
	)

	return (
		<div className="flex flex-col gap-4 sm:gap-5">
			<div className="px-1">
				<h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
					<Trans>Dashboard</Trans>
				</h1>
				<p className="text-sm text-muted-foreground mt-1">
					<Trans>Fleet overview at a glance.</Trans>
				</p>
			</div>

			<div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
				<StatusTile
					icon={ServerIcon}
					label={t`Total`}
					count={counts.total}
					tone="default"
					href={getPagePath($router, "systems")}
				/>
				<StatusTile
					icon={CircleCheckIcon}
					label={t`Up`}
					count={counts.up}
					tone="ok"
					href={getPagePath($router, "systems")}
				/>
				<StatusTile
					icon={CircleSlashIcon}
					label={t`Down`}
					count={counts.down}
					tone="warn"
					href={getPagePath($router, "systems")}
				/>
				<StatusTile
					icon={PauseIcon}
					label={t`Paused`}
					count={counts.paused}
					tone="muted"
					href={getPagePath($router, "systems")}
				/>
			</div>

			<FleetOverview systems={systems} />

			<ActiveAlerts />

			<div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4">
				<TopConsumersCard
					title={t`Top CPU usage`}
					icon={CpuIcon}
					systems={systems}
					getValue={(s) => s.info?.cpu ?? 0}
					getDisplay={(s) => `${decimalString(s.info?.cpu ?? 0, 1)}%`}
				/>
				<TopConsumersCard
					title={t`Top Memory usage`}
					icon={MemoryStickIcon}
					systems={systems}
					getValue={(s) => s.info?.mp ?? 0}
					getDisplay={(s) => `${decimalString(s.info?.mp ?? 0, 1)}%`}
				/>
				<TopConsumersCard
					title={t`Top Disk usage`}
					icon={HardDriveIcon}
					systems={systems}
					getValue={(s) => s.info?.dp ?? 0}
					getDisplay={(s) => `${decimalString(s.info?.dp ?? 0, 1)}%`}
				/>
			</div>

			<RecentActivity systems={systems} />

			{counts.total === 0 && (
				<Card className="border-dashed">
					<CardContent className="p-8 text-center">
						<AlertTriangleIcon className="size-8 text-muted-foreground mx-auto mb-3" />
						<p className="text-sm text-muted-foreground">
							<Trans>No systems registered yet. Add a system from the sidebar to get started.</Trans>
						</p>
					</CardContent>
				</Card>
			)}

			<FooterRepoLink />
		</div>
	)
})
