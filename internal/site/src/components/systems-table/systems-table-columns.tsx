/** biome-ignore-all lint/correctness/useHookAtTopLevel: Hooks live inside memoized column definitions */
import { t } from "@lingui/core/macro"
import { Trans, useLingui } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { getPagePath } from "@nanostores/router"
import type { CellContext, ColumnDef, HeaderContext } from "@tanstack/react-table"
import type { ClassValue } from "clsx"
import {
	ArrowUpDownIcon,
	ClockArrowUp,
	CopyIcon,
	CpuIcon,
	GlobeIcon,
	HardDriveIcon,
	MemoryStickIcon,
	MoreHorizontalIcon,
	NetworkIcon,
	PauseCircleIcon,
	PenBoxIcon,
	PlayCircleIcon,
	ServerIcon,
	Trash2Icon,
} from "lucide-react"
import { memo, useMemo, useRef, useState } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip"
import { isReadOnlyUser, pb } from "@/lib/api"
import { MeterState, SystemStatus } from "@/lib/enums"
import { $longestSystemNameLen, $userSettings } from "@/lib/stores"
import {
	cn,
	copyToClipboard,
	decimalString,
	formatBytes,
	formatTemperature,
	getHostDisplayValue,
	parseSemVer,
	secondsToUptimeString,
} from "@/lib/utils"
import type { SystemRecord } from "@/types"
import { SystemDialog } from "../add-system"
import AlertButton from "../alerts/alert-button"
import { $router, Link } from "../router"
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "../ui/alert-dialog"
import { Button, buttonVariants } from "../ui/button"
import { Dialog } from "../ui/dialog"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "../ui/dropdown-menu"
import { EthernetIcon, GpuIcon, HourglassIcon, ThermometerIcon } from "../ui/icons"

const STATUS_COLORS = {
	[SystemStatus.Up]: "bg-green-500",
	[SystemStatus.Down]: "bg-red-500",
	[SystemStatus.Paused]: "bg-primary/40",
	[SystemStatus.Pending]: "bg-yellow-500",
} as const

function getMeterStateByThresholds(value: number, warn = 65, crit = 90): MeterState {
	return value >= crit ? MeterState.Crit : value >= warn ? MeterState.Warn : MeterState.Good
}

/**
 * Responsive visibility classes for table columns.
 * Each value pairs `hidden` with a breakpoint at which the cell becomes visible.
 * Hidden purely via CSS so TanStack's visibility menu still controls user-toggleable state.
 */
const RESP = {
	always: "",
	mdUp: "hidden md:table-cell",
	lgUp: "hidden lg:table-cell",
	xlUp: "hidden xl:table-cell",
	xl2Up: "hidden 2xl:table-cell",
} as const

/**
 * @param viewMode - "table" or "grid"
 * @returns - Column definitions for the systems table
 */
export function SystemsTableColumns(viewMode: "table" | "grid"): ColumnDef<SystemRecord>[] {
	return [
		{
			// size: 200,
			size: 100,
			minSize: 0,
			accessorKey: "name",
			id: "system",
			name: () => t`System`,
			sortingFn: (a, b) => a.original.name.localeCompare(b.original.name),
			filterFn: (() => {
				let filterInput = ""
				let filterInputLower = ""
				const nameCache = new Map<string, string>()
				const statusTranslations = {
					[SystemStatus.Up]: t`Up`.toLowerCase(),
					[SystemStatus.Down]: t`Down`.toLowerCase(),
					[SystemStatus.Paused]: t`Paused`.toLowerCase(),
				} as const

				// match filter value against name or translated status
				return (row, _, newFilterInput) => {
					const sys = row.original
					if (sys.host.includes(newFilterInput) || sys.info.v?.includes(newFilterInput)) {
						return true
					}
					if (newFilterInput !== filterInput) {
						filterInput = newFilterInput
						filterInputLower = newFilterInput.toLowerCase()
					}
					let nameLower = nameCache.get(sys.name)
					if (nameLower === undefined) {
						nameLower = sys.name.toLowerCase()
						nameCache.set(sys.name, nameLower)
					}
					if (nameLower.includes(filterInputLower)) {
						return true
					}
					const statusLower = statusTranslations[sys.status as keyof typeof statusTranslations]
					return statusLower?.includes(filterInputLower) || false
				}
			})(),
			enableHiding: false,
			invertSorting: false,
			Icon: ServerIcon,
			cell: (info) => {
				const { name, id } = info.row.original
				const longestName = useStore($longestSystemNameLen)
				const linkUrl = getPagePath($router, "system", { id })

				return (
					<>
						<span className="flex gap-2 items-center font-medium text-sm text-nowrap md:ps-1">
							<IndicatorDot system={info.row.original} />
							<Link
								href={linkUrl}
								tabIndex={-1}
								className="truncate z-10 relative"
								style={{ width: `${longestName / 1.05}ch` }}
								onMouseEnter={(e) => {
									// set title on hover if text is truncated to show full name
									const a = e.currentTarget
									if (a.scrollWidth > a.clientWidth) {
										a.title = name
									} else {
										a.removeAttribute("title")
									}
								}}
							>
								{name}
							</Link>
						</span>
						<Link href={linkUrl} className="inset-0 absolute size-full" aria-label={name}></Link>
					</>
				)
			},
			header: sortableHeader,
		},
		{
			accessorFn: (row) => getHostDisplayValue(row),
			id: "host",
			name: () => "IP",
			size: 50,
			Icon: GlobeIcon,
			header: sortableHeader,
			hideSort: true,
			responsiveClass: RESP.mdUp,
			cell(info) {
				const host = getHostDisplayValue(info.row.original)
				return <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">{host}</span>
			},
		},
		{
			accessorFn: ({ info }) => info.cpu || undefined,
			id: "cpu",
			name: () => t`CPU`,
			cell: TableCellWithMeter,
			Icon: CpuIcon,
			header: sortableHeader,
			responsiveClass: RESP.always,
		},
		{
			// accessorKey: "info.mp",
			accessorFn: ({ info }) => info.mp || undefined,
			id: "memory",
			name: () => t`Memory`,
			cell: (info: CellContext<SystemRecord, unknown>) =>
				TableCellWithMeterAndTotal(info, info.row.original.info.mt),
			Icon: MemoryStickIcon,
			header: sortableHeader,
			responsiveClass: RESP.always,
		},
		{
			accessorFn: ({ info }) => info.dp || undefined,
			id: "disk",
			name: () => t`Disk`,
			cell: (info: CellContext<SystemRecord, unknown>) =>
				info.row.original.info.efs
					? DiskCellWithMultiple(info)
					: TableCellWithMeterAndTotal(info, info.row.original.info.ds),
			Icon: HardDriveIcon,
			header: sortableHeader,
			responsiveClass: RESP.mdUp,
		},
		{
			accessorFn: ({ info }) => info.g || undefined,
			id: "gpu",
			name: () => "GPU",
			cell: TableCellWithMeter,
			Icon: GpuIcon,
			header: sortableHeader,
			responsiveClass: RESP.xlUp,
		},
		{
			id: "loadAverage",
			accessorFn: ({ info }) => info.la?.reduce((acc, curr) => acc + curr, 0),
			name: () => t({ message: "Load Avg", comment: "Short label for load average" }),
			size: 0,
			Icon: HourglassIcon,
			header: sortableHeader,
			responsiveClass: RESP.xlUp,
			cell(info: CellContext<SystemRecord, unknown>) {
				const { info: sysInfo, status } = info.row.original
				const { major, minor } = parseSemVer(sysInfo.v)
				const { colorWarn = 65, colorCrit = 90 } = useStore($userSettings, { keys: ["colorWarn", "colorCrit"] })
				const loadAverages = sysInfo.la || []

				const max = Math.max(...loadAverages)
				if (max === 0 && (status === SystemStatus.Paused || (major < 1 && minor < 13))) {
					return null
				}

				const threads = sysInfo.t ?? 1
				const normalizedMax = max / threads
				const threshold = getMeterStateByThresholds(normalizedMax * 100, colorWarn, colorCrit)
				const windowLabels = ["1m", "5m", "15m"]

				return (
					<Tooltip delayDuration={150}>
						<TooltipTrigger asChild>
							<div className="flex items-center gap-[.35em] w-full tabular-nums tracking-tight">
								<span
									className={cn("inline-block size-2 rounded-full me-0.5", {
										[STATUS_COLORS[SystemStatus.Up]]: threshold === MeterState.Good,
										[STATUS_COLORS[SystemStatus.Pending]]: threshold === MeterState.Warn,
										[STATUS_COLORS[SystemStatus.Down]]: threshold === MeterState.Crit,
										[STATUS_COLORS[SystemStatus.Paused]]: status !== SystemStatus.Up,
									})}
								/>
								{loadAverages?.map((la, i) => (
									<span key={i}>{decimalString(la, la >= 10 ? 1 : 2)}</span>
								))}
								<span className="text-muted-foreground text-xs ms-1">({Math.round(normalizedMax * 100)}%)</span>
							</div>
						</TooltipTrigger>
						<TooltipContent className="text-xs max-w-72">
							<div className="font-semibold mb-1.5">
								<Trans>Load average vs {threads} CPU threads</Trans>
							</div>
							<div className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-0.5 mb-2 tabular-nums">
								{loadAverages.map((la, i) => (
									<div key={i} className="contents">
										<span className="text-muted-foreground">{windowLabels[i]}</span>
										<span className="text-end">{decimalString(la, 2)}</span>
										<span className="text-end text-muted-foreground">{Math.round((la / threads) * 100)}%</span>
									</div>
								))}
							</div>
							<div className="text-muted-foreground leading-snug">
								<Trans>
									Average processes using or waiting for CPU. Normalized: under 70% healthy, 70–90% busy, over
									90% overloaded.
								</Trans>
							</div>
						</TooltipContent>
					</Tooltip>
				)
			},
		},
		{
			accessorFn: ({ info, status }) => (status !== SystemStatus.Up ? undefined : info.bb),
			id: "net",
			name: () => t`Net`,
			size: 0,
			Icon: EthernetIcon,
			header: sortableHeader,
			sortUndefined: "last",
			responsiveClass: RESP.lgUp,
			cell(info) {
				const val = info.getValue() as number | undefined
				if (val === undefined) {
					return null
				}
				const userSettings = useStore($userSettings, { keys: ["unitNet"] })
				const { value, unit } = formatBytes(val, true, userSettings.unitNet, false)
				return (
					<span className="tabular-nums whitespace-nowrap">
						{decimalString(value, value >= 100 ? 1 : 2)} {unit}
					</span>
				)
			},
		},
		{
			accessorFn: ({ info }) => info.dt,
			id: "temp",
			name: () => t({ message: "Temp", comment: "Temperature label in systems table" }),
			size: 50,
			hideSort: true,
			Icon: ThermometerIcon,
			header: sortableHeader,
			responsiveClass: RESP.xlUp,
			cell(info) {
				const val = info.getValue() as number
				const userSettings = useStore($userSettings, { keys: ["unitTemp"] })
				if (!val) {
					return null
				}
				const { value, unit } = formatTemperature(val, userSettings.unitTemp)
				return (
					<span className={cn("tabular-nums whitespace-nowrap", viewMode === "table" && "ps-0.5")}>
						{decimalString(value, value >= 100 ? 1 : 2)} {unit}
					</span>
				)
			},
		},
		{
			accessorFn: ({ info }) => {
				const speeds = info.ls ? Object.values(info.ls) : []
				return speeds.length ? Math.max(...speeds) : undefined
			},
			id: "lan",
			name: () => "LAN",
			size: 50,
			Icon: NetworkIcon,
			header: sortableHeader,
			hideSort: true,
			responsiveClass: RESP.xl2Up,
			cell(info) {
				const sys = info.row.original
				const speeds = sys.info.ls ? Object.values(sys.info.ls) : []
				if (speeds.length === 0 || sys.status !== SystemStatus.Up) {
					return null
				}
				const max = Math.max(...speeds)
				const label =
					max === 0
						? t`down`
						: max >= 1000
							? `${max % 1000 === 0 ? max / 1000 : (max / 1000).toFixed(1)} Gbps`
							: `${max} Mbps`
				return (
					<span className="tabular-nums whitespace-nowrap flex gap-1.5 items-center">
						<span
							className={cn("block size-2 rounded-full", {
								[STATUS_COLORS[SystemStatus.Down]]: max === 0,
								[STATUS_COLORS[SystemStatus.Pending]]: max > 0 && max < 1000,
								[STATUS_COLORS[SystemStatus.Up]]: max >= 1000,
							})}
						/>
						{label}
					</span>
				)
			},
		},
		{
			accessorFn: ({ info }) => info.u || undefined,
			id: "uptime",
			name: () => t`Uptime`,
			size: 50,
			Icon: ClockArrowUp,
			header: sortableHeader,
			hideSort: true,
			responsiveClass: RESP.lgUp,
			cell(info) {
				const uptime = info.getValue() as number
				if (!uptime) {
					return null
				}
				return <span className="tabular-nums whitespace-nowrap">{secondsToUptimeString(uptime)}</span>
			},
		},
		{
			id: "actions",
			// @ts-expect-error
			name: () => t({ message: "Actions", comment: "Table column" }),
			size: 50,
			cell: ({ row }) => (
				<div className="relative z-10 flex justify-end items-center gap-1 -ms-3">
					<AlertButton system={row.original} />
					<ActionsButton system={row.original} />
				</div>
			),
		},
	] as ColumnDef<SystemRecord>[]
}

function sortableHeader(context: HeaderContext<SystemRecord, unknown>) {
	const { column } = context
	// @ts-expect-error
	const { Icon, hideSort, name }: { Icon: React.ElementType; name: () => string; hideSort: boolean } = column.columnDef
	const isSorted = column.getIsSorted()
	return (
		<Button
			variant="ghost"
			className={cn("h-9 px-3 flex duration-50", isSorted && "bg-accent/70 light:bg-accent text-accent-foreground/90")}
			onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
		>
			{Icon && <Icon className="me-2 size-4" />}
			{name()}
			{hideSort || <ArrowUpDownIcon className="ms-2 size-4" />}
		</Button>
	)
}

function TableCellWithMeter(info: CellContext<SystemRecord, unknown>) {
	return TableCellWithMeterAndTotal(info, undefined)
}

function TableCellWithMeterAndTotal(info: CellContext<SystemRecord, unknown>, total: number | undefined) {
	const { colorWarn = 65, colorCrit = 90 } = useStore($userSettings, { keys: ["colorWarn", "colorCrit"] })
	const val = Number(info.getValue()) || 0
	const threshold = getMeterStateByThresholds(val, colorWarn, colorCrit)
	const meterClass = cn(
		"h-full",
		(info.row.original.status !== SystemStatus.Up && STATUS_COLORS.paused) ||
			(threshold === MeterState.Good && STATUS_COLORS.up) ||
			(threshold === MeterState.Warn && STATUS_COLORS.pending) ||
			STATUS_COLORS.down
	)
	const used = total ? (total * val) / 100 : 0
	return (
		<div className="flex gap-2 items-center tabular-nums tracking-tight w-full">
			<span className="min-w-8 shrink-0">{decimalString(val, val >= 10 ? 1 : 2)}%</span>
			<span className="flex-1 min-w-8 grid bg-muted h-[1em] rounded-sm overflow-hidden">
				<span className={meterClass} style={{ width: `${val}%` }}></span>
			</span>
			{total ? (
				<span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
					{decimalString(used, used >= 10 ? 0 : 1)}/{decimalString(total, total >= 10 ? 0 : 1)} GB
				</span>
			) : null}
		</div>
	)
}

function DiskCellWithMultiple(info: CellContext<SystemRecord, unknown>) {
	const { colorWarn = 65, colorCrit = 90 } = useStore($userSettings, { keys: ["colorWarn", "colorCrit"] })
	const { info: sysInfo, status, id } = info.row.original
	const extraFs = Object.entries(sysInfo.efs ?? {})
	const rootDiskPct = sysInfo.dp

	// sort extra disks by percentage descending
	extraFs.sort((a, b) => b[1] - a[1])

	function getIndicatorColor(pct: number) {
		const threshold = getMeterStateByThresholds(pct, colorWarn, colorCrit)
		return (
			(status !== SystemStatus.Up && STATUS_COLORS.paused) ||
			(threshold === MeterState.Good && STATUS_COLORS.up) ||
			(threshold === MeterState.Warn && STATUS_COLORS.pending) ||
			STATUS_COLORS.down
		)
	}

	function getMeterClass(pct: number) {
		return cn("h-full", getIndicatorColor(pct))
	}

	// Extra disk indicators (max 3 dots - one per state if any disk exists in range)
	const stateColors = [STATUS_COLORS.up, STATUS_COLORS.pending, STATUS_COLORS.down]
	const extraDiskIndicators =
		status !== SystemStatus.Up
			? []
			: [...new Set(extraFs.map(([, pct]) => getMeterStateByThresholds(pct, colorWarn, colorCrit)))]
					.sort()
					.map((state) => stateColors[state])

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Link
					href={getPagePath($router, "system", { id })}
					tabIndex={-1}
					className="flex flex-col gap-0.5 w-full relative z-10"
				>
					<div className="flex gap-2 items-center tabular-nums tracking-tight">
						<span className="min-w-8 shrink-0">{decimalString(rootDiskPct, rootDiskPct >= 10 ? 1 : 2)}%</span>
						<span className="flex-1 min-w-8 flex items-center gap-0.5 px-1 justify-end bg-muted h-[1em] rounded-sm overflow-hidden relative">
							{/* Root disk */}
							<span
								className={cn("absolute inset-0", getMeterClass(rootDiskPct))}
								style={{ width: `${rootDiskPct}%` }}
							></span>
							{/* Extra disk indicators */}
							{extraDiskIndicators.map((color) => (
								<span
									key={color}
									className={cn("size-1.5 rounded-full shrink-0 outline-[0.5px] outline-muted", color)}
								/>
							))}
						</span>
					</div>
				</Link>
			</TooltipTrigger>
			<TooltipContent side="right" className="max-w-xs pb-2">
				<div className="grid gap-1">
					<div className="grid gap-0.5">
						<div className="text-[0.65rem] text-muted-foreground uppercase tracking-wide tabular-nums">
							<Trans context="Root disk label">Root</Trans>
						</div>
						<div className="flex gap-2 items-center tabular-nums text-xs">
							<span className="min-w-7">{decimalString(rootDiskPct, rootDiskPct >= 10 ? 1 : 2)}%</span>
							<span className="flex-1 min-w-12 grid bg-muted h-2.5 rounded-sm overflow-hidden">
								<span className={getMeterClass(rootDiskPct)} style={{ width: `${rootDiskPct}%` }}></span>
							</span>
						</div>
					</div>
					{extraFs.map(([name, pct]) => {
						return (
							<div key={name} className="grid gap-0.5">
								<div className="text-[0.65rem] max-w-40 text-muted-foreground uppercase tracking-wide truncate">
									{name}
								</div>
								<div className="flex gap-2 items-center tabular-nums text-xs">
									<span className="min-w-7">{decimalString(pct, pct >= 10 ? 1 : 2)}%</span>
									<span className="flex-1 min-w-12 grid bg-muted h-2.5 rounded-sm overflow-hidden">
										<span className={getMeterClass(pct)} style={{ width: `${pct}%` }}></span>
									</span>
								</div>
							</div>
						)
					})}
				</div>
			</TooltipContent>
		</Tooltip>
	)
}

export function IndicatorDot({ system, className }: { system: SystemRecord; className?: ClassValue }) {
	className ||= STATUS_COLORS[system.status as keyof typeof STATUS_COLORS] || ""
	return (
		<span
			className={cn("shrink-0 size-2 rounded-full", className)}
			// style={{ marginBottom: "-1px" }}
		/>
	)
}

export const ActionsButton = memo(({ system }: { system: SystemRecord }) => {
	const [deleteOpen, setDeleteOpen] = useState(false)
	const [editOpen, setEditOpen] = useState(false)
	const editOpened = useRef(false)
	const { t } = useLingui()
	const { id, status, host, name } = system

	return useMemo(() => {
		return (
			<>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size={"icon"}>
							<span className="sr-only">
								<Trans>Open menu</Trans>
							</span>
							<MoreHorizontalIcon className="w-5" />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{!isReadOnlyUser() && (
							<DropdownMenuItem
								onSelect={() => {
									editOpened.current = true
									setEditOpen(true)
								}}
							>
								<PenBoxIcon className="me-2.5 size-4" />
								<Trans>Edit</Trans>
							</DropdownMenuItem>
						)}
						<DropdownMenuItem
							className={cn(isReadOnlyUser() && "hidden")}
							onClick={() => {
								pb.collection("systems").update(id, {
									status: status === SystemStatus.Paused ? SystemStatus.Pending : SystemStatus.Paused,
								})
							}}
						>
							{status === SystemStatus.Paused ? (
								<>
									<PlayCircleIcon className="me-2.5 size-4" />
									<Trans>Resume</Trans>
								</>
							) : (
								<>
									<PauseCircleIcon className="me-2.5 size-4" />
									<Trans>Pause</Trans>
								</>
							)}
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => copyToClipboard(name)}>
							<CopyIcon className="me-2.5 size-4" />
							<Trans>Copy name</Trans>
						</DropdownMenuItem>
						<DropdownMenuItem onClick={() => copyToClipboard(host)}>
							<CopyIcon className="me-2.5 size-4" />
							<Trans>Copy host</Trans>
						</DropdownMenuItem>
						<DropdownMenuSeparator className={cn(isReadOnlyUser() && "hidden")} />
						<DropdownMenuItem className={cn(isReadOnlyUser() && "hidden")} onSelect={() => setDeleteOpen(true)}>
							<Trash2Icon className="me-2.5 size-4" />
							<Trans>Delete</Trans>
						</DropdownMenuItem>
					</DropdownMenuContent>
				</DropdownMenu>
				{/* edit dialog */}
				<Dialog open={editOpen} onOpenChange={setEditOpen}>
					{editOpened.current && <SystemDialog system={system} setOpen={setEditOpen} />}
				</Dialog>
				{/* deletion dialog */}
				<AlertDialog open={deleteOpen} onOpenChange={(open) => setDeleteOpen(open)}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>
								<Trans>Are you sure you want to delete {name}?</Trans>
							</AlertDialogTitle>
							<AlertDialogDescription>
								<Trans>
									This action cannot be undone. This will permanently delete all current records for {name} from the
									database.
								</Trans>
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel>
								<Trans>Cancel</Trans>
							</AlertDialogCancel>
							<AlertDialogAction
								className={cn(buttonVariants({ variant: "destructive" }))}
								onClick={() => pb.collection("systems").delete(id)}
							>
								<Trans>Continue</Trans>
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			</>
		)
	}, [id, status, host, name, system, t, deleteOpen, editOpen])
})
