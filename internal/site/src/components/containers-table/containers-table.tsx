/** biome-ignore-all lint/security/noDangerouslySetInnerHtml: html comes directly from docker via agent */
import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import {
	type ColumnFiltersState,
	flexRender,
	getCoreRowModel,
	getFilteredRowModel,
	getSortedRowModel,
	type Row,
	type SortingState,
	type Table as TableType,
	useReactTable,
	type VisibilityState,
} from "@tanstack/react-table"
import { memo, type RefObject, useEffect, useMemo, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { pb } from "@/lib/api"
import type { ContainerRecord } from "@/types"
import { containerChartCols } from "@/components/containers-table/containers-table-columns"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { type ContainerHealth, ContainerHealthLabels } from "@/lib/enums"
import { cn, useBrowserStorage } from "@/lib/utils"
import { Sheet, SheetTitle, SheetHeader, SheetContent, SheetDescription } from "../ui/sheet"
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog"
import { Button } from "@/components/ui/button"
import { $allSystemsById } from "@/lib/stores"
import {
	LayoutGridIcon,
	LayoutListIcon,
	LoaderCircleIcon,
	MaximizeIcon,
	RefreshCwIcon,
	Settings2Icon,
	XIcon,
} from "lucide-react"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"
import { ContainerHealth as ContainerHealthEnum } from "@/lib/enums"
import { decimalString, formatBytes } from "@/lib/utils"
import { Separator } from "../ui/separator"
import { $router, Link } from "../router"
import { listenKeys } from "nanostores"
import { getPagePath } from "@nanostores/router"

type ContainersViewMode = "table" | "grid"

const syntaxTheme = "github-dark-dimmed"

export default function ContainersTable({ systemId }: { systemId?: string }) {
	const loadTime = Date.now()
	const [data, setData] = useState<ContainerRecord[] | undefined>(undefined)
	const [sorting, setSorting] = useBrowserStorage<SortingState>(
		`sort-c-${systemId ? 1 : 0}`,
		[{ id: systemId ? "name" : "system", desc: false }],
		sessionStorage
	)
	const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
	const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({})

	// Hide ports column if no ports are present
	useEffect(() => {
		if (data) {
			const hasPorts = data.some((container) => container.ports)
			setColumnVisibility((prev) => {
				if (prev.ports === hasPorts) {
					return prev
				}
				return { ...prev, ports: hasPorts }
			})
		}
	}, [data])

	const [rowSelection, setRowSelection] = useState({})
	const [globalFilter, setGlobalFilter] = useState("")
	const [viewMode, setViewMode] = useBrowserStorage<ContainersViewMode>(
		`c-viewMode-${systemId ? 1 : 0}`,
		typeof window !== "undefined" && window.innerWidth < 1024 ? "grid" : "table"
	)

	useEffect(() => {
		function fetchData(systemId?: string) {
			pb.collection<ContainerRecord>("containers")
				.getList(0, 2000, {
					fields: "id,name,image,ports,cpu,memory,net,health,status,system,updated",
					filter: systemId ? pb.filter("system={:system}", { system: systemId }) : undefined,
				})
				.then(({ items }) => {
					if (items.length === 0) {
						setData((curItems) => {
							if (systemId) {
								return curItems?.filter((item) => item.system !== systemId) ?? []
							}
							return []
						})
						return
					}
					setData((curItems) => {
						const lastUpdated = Math.max(items[0].updated, items.at(-1)?.updated ?? 0)
						const containerIds = new Set()
						const newItems: ContainerRecord[] = []
						for (const item of items) {
							if (Math.abs(lastUpdated - item.updated) < 70_000) {
								containerIds.add(item.id)
								newItems.push(item)
							}
						}
						for (const item of curItems ?? []) {
							if (!containerIds.has(item.id) && lastUpdated - item.updated < 70_000) {
								newItems.push(item)
							}
						}
						return newItems
					})
				})
		}

		// initial load
		fetchData(systemId)

		// if no systemId, pull system containers after every system update
		if (!systemId) {
			return $allSystemsById.listen((_value, _oldValue, systemId) => {
				// exclude initial load of systems
				if (Date.now() - loadTime > 500) {
					fetchData(systemId)
				}
			})
		}

		// if systemId, fetch containers after the system is updated
		return listenKeys($allSystemsById, [systemId], (_newSystems) => {
			fetchData(systemId)
		})
	}, [])

	const table = useReactTable({
		data: data ?? [],
		columns: containerChartCols.filter((col) => (systemId ? col.id !== "system" : true)),
		getCoreRowModel: getCoreRowModel(),
		getSortedRowModel: getSortedRowModel(),
		getFilteredRowModel: getFilteredRowModel(),
		onSortingChange: setSorting,
		onColumnFiltersChange: setColumnFilters,
		onColumnVisibilityChange: setColumnVisibility,
		onRowSelectionChange: setRowSelection,
		defaultColumn: {
			sortUndefined: "last",
			size: 100,
			minSize: 0,
		},
		state: {
			sorting,
			columnFilters,
			columnVisibility,
			rowSelection,
			globalFilter,
		},
		onGlobalFilterChange: setGlobalFilter,
		globalFilterFn: (row, _columnId, filterValue) => {
			const container = row.original
			const systemName = $allSystemsById.get()[container.system]?.name ?? ""
			const id = container.id ?? ""
			const name = container.name ?? ""
			const status = container.status ?? ""
			const healthLabel = ContainerHealthLabels[container.health as ContainerHealth] ?? ""
			const image = container.image ?? ""
			const ports = container.ports ?? ""
			const searchString = `${systemName} ${id} ${name} ${healthLabel} ${status} ${image} ${ports}`.toLowerCase()

			return (filterValue as string)
				.toLowerCase()
				.split(" ")
				.every((term) => searchString.includes(term))
		},
	})

	const rows = table.getRowModel().rows
	const visibleColumns = table.getVisibleLeafColumns()

	return (
		<Card className="@container w-full px-3 py-5 sm:py-6 sm:px-6">
			<CardHeader className="p-0 mb-3 sm:mb-4">
				<div className="grid md:flex gap-x-5 gap-y-3 w-full items-end">
					<div className="px-2 sm:px-1">
						<CardTitle className="mb-2">
							<Trans>All Containers</Trans>
						</CardTitle>
						<CardDescription className="flex">
							<Trans>Click on a container to view more information.</Trans>
						</CardDescription>
					</div>
					<div className="flex gap-2 ms-auto w-full md:w-auto">
						<div className="relative flex-1 md:w-64">
							<Input
								placeholder={t`Filter...`}
								value={globalFilter}
								onChange={(e) => setGlobalFilter(e.target.value)}
								className="ps-4 pe-10 w-full"
							/>
							{globalFilter && (
								<Button
									type="button"
									variant="ghost"
									size="icon"
									aria-label={t`Clear`}
									className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground"
									onClick={() => setGlobalFilter("")}
								>
									<XIcon className="h-4 w-4" />
								</Button>
							)}
						</div>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="outline">
									<Settings2Icon className="me-1.5 size-4 opacity-80" />
									<Trans>View</Trans>
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="min-w-44">
								<DropdownMenuLabel className="pt-2 px-3.5 flex items-center gap-2">
									<LayoutGridIcon className="size-4" />
									<Trans>Layout</Trans>
								</DropdownMenuLabel>
								<DropdownMenuSeparator />
								<DropdownMenuRadioGroup
									className="px-1 pb-1"
									value={viewMode}
									onValueChange={(value) => setViewMode(value as ContainersViewMode)}
								>
									<DropdownMenuRadioItem value="table" onSelect={(e) => e.preventDefault()} className="gap-2">
										<LayoutListIcon className="size-4" />
										<Trans>Table</Trans>
									</DropdownMenuRadioItem>
									<DropdownMenuRadioItem value="grid" onSelect={(e) => e.preventDefault()} className="gap-2">
										<LayoutGridIcon className="size-4" />
										<Trans>Grid</Trans>
									</DropdownMenuRadioItem>
								</DropdownMenuRadioGroup>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
				</div>
			</CardHeader>
			<div className="rounded-md">
				<AllContainersTable
					table={table}
					rows={rows}
					colLength={visibleColumns.length}
					data={data}
					viewMode={viewMode}
					systemId={systemId}
				/>
			</div>
		</Card>
	)
}

const AllContainersTable = memo(function AllContainersTable({
	table,
	rows,
	data,
	viewMode,
	systemId,
}: {
	table: TableType<ContainerRecord>
	rows: Row<ContainerRecord>[]
	colLength: number
	data: ContainerRecord[] | undefined
	viewMode: ContainersViewMode
	systemId: string | undefined
}) {
	const activeContainer = useRef<ContainerRecord | null>(null)
	const [sheetOpen, setSheetOpen] = useState(false)
	const openSheet = (container: ContainerRecord) => {
		activeContainer.current = container
		setSheetOpen(true)
	}

	const groups = useMemo(() => {
		if (systemId) {
			return [{ id: systemId, name: "", rows }]
		}
		const allSystems = $allSystemsById.get()
		const map = new Map<string, Row<ContainerRecord>[]>()
		for (const row of rows) {
			const sysId = row.original.system
			let bucket = map.get(sysId)
			if (!bucket) {
				bucket = []
				map.set(sysId, bucket)
			}
			bucket.push(row)
		}
		return Array.from(map, ([id, groupRows]) => ({
			id,
			name: allSystems[id]?.name ?? id,
			rows: groupRows,
		})).sort((a, b) => a.name.localeCompare(b.name))
	}, [rows, systemId])

	if (!rows.length) {
		return (
			<div className="text-center py-12 text-muted-foreground">
				{data ? <Trans>No results.</Trans> : <LoaderCircleIcon className="animate-spin size-10 opacity-60 mx-auto" />}
			</div>
		)
	}

	return (
		<>
			<div className="flex flex-col gap-5">
				{groups.map((group) => (
					<SystemSection
						key={group.id}
						systemId={group.id}
						systemName={group.name}
						rows={group.rows}
						table={table}
						viewMode={viewMode}
						showHeader={!systemId}
						openSheet={openSheet}
					/>
				))}
			</div>
			<ContainerSheet sheetOpen={sheetOpen} setSheetOpen={setSheetOpen} activeContainer={activeContainer} />
		</>
	)
})

function SystemSection({
	systemId,
	systemName,
	rows,
	table,
	viewMode,
	showHeader,
	openSheet,
}: {
	systemId: string
	systemName: string
	rows: Row<ContainerRecord>[]
	table: TableType<ContainerRecord>
	viewMode: ContainersViewMode
	showHeader: boolean
	openSheet: (c: ContainerRecord) => void
}) {
	return (
		<div>
			{showHeader && (
				<div className="flex items-center gap-2 mb-2 px-1">
					<Link
						href={getPagePath($router, "system", { id: systemId })}
						className="font-semibold text-base hover:underline"
					>
						{systemName}
					</Link>
					<Badge variant="outline" className="dark:border-white/12 text-xs">
						{rows.length}
					</Badge>
				</div>
			)}
			{viewMode === "grid" ? (
				<div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
					{rows.map((row) => (
						<ContainerCard
							key={row.id}
							container={row.original}
							openSheet={openSheet}
							hideSystem={showHeader}
						/>
					))}
				</div>
			) : (
				<div className="border rounded-md overflow-auto max-w-full">
					<table className="text-sm w-full text-nowrap">
						<ContainersTableHead table={table} hideSystem={showHeader} />
						<TableBody>
							{rows.map((row) => (
								<ContainerTableRow
									key={row.id}
									row={row}
									openSheet={openSheet}
									hideSystem={showHeader}
								/>
							))}
						</TableBody>
					</table>
				</div>
			)}
		</div>
	)
}

const ContainerCard = memo(function ContainerCard({
	container,
	openSheet,
	hideSystem,
}: {
	container: ContainerRecord
	openSheet: (c: ContainerRecord) => void
	hideSystem?: boolean
}) {
	const allSystems = $allSystemsById.get()
	const systemName = allSystems[container.system]?.name ?? ""
	const mem = formatBytes(container.memory ?? 0, false, undefined, true)
	const net = formatBytes(container.net ?? 0, true, undefined, false)
	const healthDot =
		container.health === ContainerHealthEnum.Healthy
			? "bg-green-500"
			: container.health === ContainerHealthEnum.Unhealthy
				? "bg-red-500"
				: container.health === ContainerHealthEnum.Starting
					? "bg-yellow-500"
					: "bg-zinc-500"

	return (
		<button
			type="button"
			onClick={() => openSheet(container)}
			className="group text-start w-full"
			aria-label={container.name}
		>
			<Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
				<CardHeader className="py-2 ps-4 pe-3 bg-muted/30 border-b border-border/60 flex-row items-center gap-2">
					<span className={cn("size-2 shrink-0 rounded-full", healthDot)} aria-hidden />
					<h3 className="font-semibold text-primary/90 truncate flex-1 min-w-0 text-[.95em]/normal">
						{container.name}
					</h3>
					{!hideSystem && systemName && (
						<Badge variant="outline" className="dark:border-white/12 shrink-0 max-w-32 truncate">
							{systemName}
						</Badge>
					)}
				</CardHeader>
				<div className="text-sm px-4 py-3 grid gap-1.5" style={{ gridTemplateColumns: "minmax(70px, max-content) 1fr" }}>
					<div className="text-muted-foreground"><Trans>CPU</Trans></div>
					<div className="tabular-nums">{decimalString(container.cpu ?? 0, (container.cpu ?? 0) >= 10 ? 1 : 2)}%</div>
					<div className="text-muted-foreground"><Trans>Memory</Trans></div>
					<div className="tabular-nums">
						{decimalString(mem.value, mem.value >= 10 ? 1 : 2)} {mem.unit}
					</div>
					<div className="text-muted-foreground"><Trans>Net</Trans></div>
					<div className="tabular-nums">
						{decimalString(net.value, net.value >= 10 ? 1 : 2)} {net.unit}
					</div>
					{container.ports && (
						<>
							<div className="text-muted-foreground"><Trans>Ports</Trans></div>
							<div className="tabular-nums truncate" title={container.ports}>
								{container.ports}
							</div>
						</>
					)}
					<div className="text-muted-foreground"><Trans>Image</Trans></div>
					<div className="truncate" title={container.image}>
						{container.image}
					</div>
				</div>
			</Card>
		</button>
	)
})

async function getLogsHtml(container: ContainerRecord): Promise<string> {
	try {
		const [{ highlighter }, logsHtml] = await Promise.all([
			import("@/lib/shiki"),
			pb.send<{ logs: string }>("/api/bantay/containers/logs", {
				system: container.system,
				container: container.id,
			}),
		])
		return logsHtml.logs ? highlighter.codeToHtml(logsHtml.logs, { lang: "log", theme: syntaxTheme }) : t`No results.`
	} catch (error) {
		console.error(error)
		return ""
	}
}

async function getInfoHtml(container: ContainerRecord): Promise<string> {
	try {
		let [{ highlighter }, { info }] = await Promise.all([
			import("@/lib/shiki"),
			pb.send<{ info: string }>("/api/bantay/containers/info", {
				system: container.system,
				container: container.id,
			}),
		])
		try {
			info = JSON.stringify(JSON.parse(info), null, 2)
		} catch (_) {}
		return info ? highlighter.codeToHtml(info, { lang: "json", theme: syntaxTheme }) : t`No results.`
	} catch (error) {
		console.error(error)
		return ""
	}
}

function ContainerSheet({
	sheetOpen,
	setSheetOpen,
	activeContainer,
}: {
	sheetOpen: boolean
	setSheetOpen: (open: boolean) => void
	activeContainer: RefObject<ContainerRecord | null>
}) {
	const [logsDisplay, setLogsDisplay] = useState<string>("")
	const [infoDisplay, setInfoDisplay] = useState<string>("")
	const [logsFullscreenOpen, setLogsFullscreenOpen] = useState<boolean>(false)
	const [infoFullscreenOpen, setInfoFullscreenOpen] = useState<boolean>(false)
	const [isRefreshingLogs, setIsRefreshingLogs] = useState<boolean>(false)
	const logsContainerRef = useRef<HTMLDivElement>(null)

	const container = activeContainer.current

	function scrollLogsToBottom() {
		if (logsContainerRef.current) {
			logsContainerRef.current.scrollTo({ top: logsContainerRef.current.scrollHeight })
		}
	}

	const refreshLogs = async () => {
		if (!container) return
		setIsRefreshingLogs(true)
		const startTime = Date.now()

		try {
			const logsHtml = await getLogsHtml(container)
			setLogsDisplay(logsHtml)
			setTimeout(scrollLogsToBottom, 20)
		} catch (error) {
			console.error(error)
		} finally {
			// Ensure minimum spin duration of 800ms
			const elapsed = Date.now() - startTime
			const remaining = Math.max(0, 500 - elapsed)
			setTimeout(() => {
				setIsRefreshingLogs(false)
			}, remaining)
		}
	}

	useEffect(() => {
		setLogsDisplay("")
		setInfoDisplay("")
		if (!container) return
		;(async () => {
			const [logsHtml, infoHtml] = await Promise.all([getLogsHtml(container), getInfoHtml(container)])
			setLogsDisplay(logsHtml)
			setInfoDisplay(infoHtml)
			setTimeout(scrollLogsToBottom, 20)
		})()
	}, [container])

	if (!container) return null

	return (
		<>
			<LogsFullscreenDialog
				open={logsFullscreenOpen}
				onOpenChange={setLogsFullscreenOpen}
				logsDisplay={logsDisplay}
				containerName={container.name}
				onRefresh={refreshLogs}
				isRefreshing={isRefreshingLogs}
			/>
			<InfoFullscreenDialog
				open={infoFullscreenOpen}
				onOpenChange={setInfoFullscreenOpen}
				infoDisplay={infoDisplay}
				containerName={container.name}
			/>
			<Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
				<SheetContent className="w-full sm:max-w-220 p-2">
					<SheetHeader>
						<SheetTitle>{container.name}</SheetTitle>
						<SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-1">
							<Link className="hover:underline" href={getPagePath($router, "system", { id: container.system })}>
								{$allSystemsById.get()[container.system]?.name ?? ""}
							</Link>
							<Separator orientation="vertical" className="h-2.5 bg-muted-foreground opacity-70" />
							{container.status}
							<Separator orientation="vertical" className="h-2.5 bg-muted-foreground opacity-70" />
							{container.image}
							<Separator orientation="vertical" className="h-2.5 bg-muted-foreground opacity-70" />
							{container.id}
							{/* {container.ports && (
								<>
									<Separator orientation="vertical" className="h-2.5 bg-muted-foreground opacity-70" />
									{container.ports}
								</>
							)} */}
							{/* <Separator orientation="vertical" className="h-2.5 bg-muted-foreground opacity-70" />
							{ContainerHealthLabels[container.health as ContainerHealth]} */}
						</SheetDescription>
					</SheetHeader>
					<div className="px-3 pb-3 -mt-4 flex flex-col gap-3 h-full items-start">
						<div className="flex items-center w-full">
							<h3>{t`Logs`}</h3>
							<Button
								variant="ghost"
								size="sm"
								onClick={refreshLogs}
								className="h-8 w-8 p-0 ms-auto"
								disabled={isRefreshingLogs}
							>
								<RefreshCwIcon
									className={`size-4 transition-transform duration-300 ${isRefreshingLogs ? "animate-spin" : ""}`}
								/>
							</Button>
							<Button variant="ghost" size="sm" onClick={() => setLogsFullscreenOpen(true)} className="h-8 w-8 p-0">
								<MaximizeIcon className="size-4" />
							</Button>
						</div>
						<div
							ref={logsContainerRef}
							className={cn(
								"max-h-[calc(50dvh-10rem)] w-full overflow-auto p-3 rounded-md bg-gh-dark text-white text-sm",
								!logsDisplay && ["animate-pulse", "h-full"]
							)}
						>
							<div dangerouslySetInnerHTML={{ __html: logsDisplay }} />
						</div>
						<div className="flex items-center w-full">
							<h3>{t`Detail`}</h3>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setInfoFullscreenOpen(true)}
								className="h-8 w-8 p-0 ms-auto"
							>
								<MaximizeIcon className="size-4" />
							</Button>
						</div>
						<div
							className={cn(
								"grow h-[calc(50dvh-4rem)] w-full overflow-auto p-3 rounded-md bg-gh-dark text-white text-sm",
								!infoDisplay && "animate-pulse"
							)}
						>
							<div dangerouslySetInnerHTML={{ __html: infoDisplay }} />
						</div>
					</div>
				</SheetContent>
			</Sheet>
		</>
	)
}

function ContainersTableHead({
	table,
	hideSystem,
}: {
	table: TableType<ContainerRecord>
	hideSystem?: boolean
}) {
	return (
		<TableHeader className="sticky top-0 z-50 w-full border-b-2">
			{table.getHeaderGroups().map((headerGroup) => (
				<tr key={headerGroup.id}>
					{headerGroup.headers.map((header) => {
						if (hideSystem && header.column.id === "system") return null
						const responsiveClass = (header.column.columnDef as { responsiveClass?: string }).responsiveClass
						return (
							<TableHead
								className={cn("px-2", responsiveClass)}
								key={header.id}
								style={{ width: header.getSize() }}
							>
								{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
							</TableHead>
						)
					})}
				</tr>
			))}
		</TableHeader>
	)
}

const ContainerTableRow = memo(function ContainerTableRow({
	row,
	openSheet,
	hideSystem,
}: {
	row: Row<ContainerRecord>
	openSheet: (container: ContainerRecord) => void
	hideSystem?: boolean
}) {
	return (
		<TableRow
			data-state={row.getIsSelected() && "selected"}
			className="cursor-pointer transition-opacity"
			onClick={() => openSheet(row.original)}
		>
			{row.getVisibleCells().map((cell) => {
				if (hideSystem && cell.column.id === "system") return null
				const responsiveClass = (cell.column.columnDef as { responsiveClass?: string }).responsiveClass
				return (
					<TableCell
						key={cell.id}
						className={cn("py-0 ps-4.5 h-13", responsiveClass)}
						style={{
							width: cell.column.getSize(),
						}}
					>
						{flexRender(cell.column.columnDef.cell, cell.getContext())}
					</TableCell>
				)
			})}
		</TableRow>
	)
})

function LogsFullscreenDialog({
	open,
	onOpenChange,
	logsDisplay,
	containerName,
	onRefresh,
	isRefreshing,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	logsDisplay: string
	containerName: string
	onRefresh: () => void | Promise<void>
	isRefreshing: boolean
}) {
	const outerContainerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (open && logsDisplay) {
			// Scroll the outer container to bottom
			const scrollToBottom = () => {
				if (outerContainerRef.current) {
					outerContainerRef.current.scrollTop = outerContainerRef.current.scrollHeight
				}
			}
			setTimeout(scrollToBottom, 50)
		}
	}, [open, logsDisplay])

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="w-[calc(100vw-20px)] h-[calc(100dvh-20px)] max-w-none p-0 bg-gh-dark border-0 text-white">
				<DialogTitle className="sr-only">{containerName} logs</DialogTitle>
				<div ref={outerContainerRef} className="h-full overflow-auto">
					<div className="h-full w-full px-3 leading-relaxed rounded-md bg-gh-dark text-sm">
						<div className="py-3" dangerouslySetInnerHTML={{ __html: logsDisplay }} />
					</div>
				</div>
				<button
					onClick={onRefresh}
					className="absolute top-3 right-11 opacity-60 hover:opacity-100 p-1"
					disabled={isRefreshing}
					title={t`Refresh`}
					aria-label={t`Refresh`}
				>
					<RefreshCwIcon className={`size-4 transition-transform duration-300 ${isRefreshing ? "animate-spin" : ""}`} />
				</button>
			</DialogContent>
		</Dialog>
	)
}

function InfoFullscreenDialog({
	open,
	onOpenChange,
	infoDisplay,
	containerName,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
	infoDisplay: string
	containerName: string
}) {
	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="w-[calc(100vw-20px)] h-[calc(100dvh-20px)] max-w-none p-0 bg-gh-dark border-0 text-white">
				<DialogTitle className="sr-only">{containerName} info</DialogTitle>
				<div className="flex-1 overflow-auto">
					<div className="h-full w-full overflow-auto p-3 rounded-md bg-gh-dark text-sm leading-relaxed">
						<div dangerouslySetInnerHTML={{ __html: infoDisplay }} />
					</div>
				</div>
			</DialogContent>
		</Dialog>
	)
}
