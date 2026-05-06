import { plural } from "@lingui/core/macro"
import { Trans, useLingui } from "@lingui/react/macro"
import {
	AppleIcon,
	ArrowLeftIcon,
	ChevronRightSquareIcon,
	ClockArrowUp,
	CpuIcon,
	GlobeIcon,
	Loader2Icon,
	MemoryStickIcon,
	MonitorIcon,
	NetworkIcon,
	RotateCwIcon,
	Settings2Icon,
} from "lucide-react"
import { useMemo, useState } from "react"
import { getPagePath } from "@nanostores/router"
import ChartTimeSelect from "@/components/charts/chart-time-select"
import { $router, navigate } from "@/components/router"
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
import { Card } from "@/components/ui/card"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FreeBsdIcon, TuxIcon, WebSocketIcon, WindowsIcon } from "@/components/ui/icons"
import { Separator } from "@/components/ui/separator"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { toast } from "@/components/ui/use-toast"
import { isAdmin, pb } from "@/lib/api"
import { ConnectionType, connectionTypeLabels, Os, SystemStatus } from "@/lib/enums"
import { cn, formatBytes, getHostDisplayValue, secondsToUptimeString, toFixedFloat } from "@/lib/utils"
import type { ChartData, SystemDetailsRecord, SystemRecord } from "@/types"

function formatLinkSpeed(mbps: number): string {
	if (mbps >= 1000) {
		const gbps = mbps / 1000
		return `${gbps % 1 === 0 ? gbps : gbps.toFixed(1)} Gbps`
	}
	return `${mbps} Mbps`
}

export default function InfoBar({
	system,
	chartData,
	grid,
	setGrid,
	displayMode,
	setDisplayMode,
	details,
}: {
	system: SystemRecord
	chartData: ChartData
	grid: boolean
	setGrid: (grid: boolean) => void
	displayMode: "default" | "tabs"
	setDisplayMode: (mode: "default" | "tabs") => void
	details: SystemDetailsRecord | null
}) {
	const { t } = useLingui()
	const [restartOpen, setRestartOpen] = useState(false)
	const [restarting, setRestarting] = useState(false)
	const showRestart = isAdmin()

	const handleBack = () => {
		const sameOrigin =
			!!document.referrer &&
			(() => {
				try {
					return new URL(document.referrer).origin === window.location.origin
				} catch {
					return false
				}
			})()
		if (sameOrigin && window.history.length > 1) {
			window.history.back()
		} else {
			navigate(getPagePath($router, "systems"))
		}
	}

	async function handleRestartConfirm() {
		setRestarting(true)
		try {
			await pb.send(`/api/bantay/admin/agents/restart?system=${system.id}`, { method: "POST" })
			toast({ title: t`Restart requested`, description: system.name })
			setRestartOpen(false)
		} catch (err) {
			const e = err as { message?: string; data?: { message?: string } }
			toast({
				title: t`Restart failed`,
				description: e?.data?.message || e?.message || t`Agent did not respond.`,
				variant: "destructive",
			})
		} finally {
			setRestarting(false)
		}
	}

	// values for system info bar - use details with fallback to system.info
	const systemInfo = useMemo(() => {
		if (!system.info) {
			return []
		}

		// Use details if available, otherwise fall back to system.info
		const hostname = details?.hostname ?? system.info.h
		const kernel = details?.kernel ?? system.info.k
		const cores = details?.cores ?? system.info.c
		const threads = details?.threads ?? system.info.t ?? 0
		const cpuModel = details?.cpu ?? system.info.m
		const os = details?.os ?? system.info.os ?? Os.Linux
		const osName = details?.os_name
		const arch = details?.arch
		const memory = details?.memory

		const osInfo = {
			[Os.Linux]: {
				Icon: TuxIcon,
				// show kernel in tooltip if os name is available, otherwise show the kernel
				value: osName || kernel,
				label: osName ? kernel : undefined,
			},
			[Os.Darwin]: {
				Icon: AppleIcon,
				value: osName || `macOS ${kernel}`,
			},
			[Os.Windows]: {
				Icon: WindowsIcon,
				value: osName || kernel,
				label: osName ? kernel : undefined,
			},
			[Os.FreeBSD]: {
				Icon: FreeBsdIcon,
				value: osName || kernel,
				label: osName ? kernel : undefined,
			},
		}

		const info = [
			{ value: getHostDisplayValue(system), Icon: GlobeIcon },
			{
				value: hostname,
				Icon: MonitorIcon,
				label: "Hostname",
				// hide if hostname is same as host or name
				hide: hostname === system.host || hostname === system.name,
			},
			{ value: secondsToUptimeString(system.info.u), Icon: ClockArrowUp, label: t`Uptime`, hide: !system.info.u },
			osInfo[os],
			{
				value: cpuModel,
				Icon: CpuIcon,
				hide: !cpuModel,
				label: `${plural(cores, { one: "# core", other: "# cores" })} / ${plural(threads, { one: "# thread", other: "# threads" })}${arch ? ` / ${arch}` : ""}`,
			},
		] as {
			value: string | number | undefined
			label?: string
			Icon: React.ElementType
			hide?: boolean
		}[]

		if (memory) {
			const memValue = formatBytes(memory, false, undefined, false)
			info.push({
				value: `${toFixedFloat(memValue.value, memValue.value >= 10 ? 1 : 2)} ${memValue.unit}`,
				Icon: MemoryStickIcon,
				hide: !memory,
				label: t`Memory`,
			})
		}

		return info
	}, [system, details, t])

	let translatedStatus: string = system.status
	if (system.status === SystemStatus.Up) {
		translatedStatus = t({ message: "Up", comment: "Context: System is up" })
	} else if (system.status === SystemStatus.Down) {
		translatedStatus = t({ message: "Down", comment: "Context: System is down" })
	}

	return (
		<Card>
			<div className="grid xl:flex xl:gap-4 px-4 sm:px-6 pt-3 sm:pt-4 pb-5">
				<div className="min-w-0">
					<div className="flex items-center gap-2 mb-1.5">
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									aria-label={t`Back`}
									variant="ghost"
									size="icon"
									className="size-8 -ms-1.5 text-muted-foreground hover:text-primary"
									onClick={handleBack}
								>
									<ArrowLeftIcon className="size-4" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								<Trans>Back</Trans>
							</TooltipContent>
						</Tooltip>
						<h1 className="text-2xl sm:text-[1.6rem] font-semibold">{system.name}</h1>
					</div>
					<div className="flex xl:flex-wrap items-center py-4 xl:p-0 -mt-3 xl:mt-1 gap-3 text-sm text-nowrap opacity-90 overflow-x-auto scrollbar-hide -mx-4 px-4 xl:mx-0">
						<Tooltip>
							<TooltipTrigger asChild>
								<div className="capitalize flex gap-2 items-center">
									<span className={cn("relative flex h-3 w-3")}>
										{system.status === SystemStatus.Up && (
											<span
												className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"
												style={{ animationDuration: "1.5s" }}
											></span>
										)}
										<span
											className={cn("relative inline-flex rounded-full h-3 w-3", {
												"bg-green-500": system.status === SystemStatus.Up,
												"bg-red-500": system.status === SystemStatus.Down,
												"bg-primary/40": system.status === SystemStatus.Paused,
												"bg-yellow-500": system.status === SystemStatus.Pending,
											})}
										></span>
									</span>
									{translatedStatus}
								</div>
							</TooltipTrigger>
							{system.info.ct && (
								<TooltipContent>
									<div className="flex gap-1 items-center">
										{system.info.ct === ConnectionType.WebSocket ? (
											<WebSocketIcon className="size-4" />
										) : (
											<ChevronRightSquareIcon className="size-4" strokeWidth={2} />
										)}
										{connectionTypeLabels[system.info.ct as ConnectionType]}
									</div>
								</TooltipContent>
							)}
						</Tooltip>

						{systemInfo.map(({ value, label, Icon, hide }) => {
							if (hide || !value) {
								return null
							}
							const content = (
								<div className="flex gap-1.5 items-center">
									<Icon className="h-4 w-4" /> {value}
								</div>
							)
							return (
								<div key={value} className="contents">
									<Separator orientation="vertical" className="h-4 bg-primary/30" />
									{label ? (
										<Tooltip delayDuration={100}>
											<TooltipTrigger asChild>{content}</TooltipTrigger>
											<TooltipContent>{label}</TooltipContent>
										</Tooltip>
									) : (
										content
									)}
								</div>
							)
						})}
					</div>
					{system.info.ls && Object.keys(system.info.ls).length > 0 && (
						<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm mt-2 pt-2 border-t border-border/50">
							<span className="flex items-center gap-1.5 text-muted-foreground text-xs uppercase tracking-wider">
								<NetworkIcon className="size-3.5" />
								<Trans>NICs</Trans>
							</span>
							{Object.entries(system.info.ls)
								.sort(([a], [b]) => a.localeCompare(b))
								.map(([name, mbps]) => (
									<div key={name} className="flex items-center gap-1.5">
										<span className="font-mono text-xs text-muted-foreground">{name}</span>
										<span
											className={cn(
												"tabular-nums text-xs font-medium",
												mbps === 0
													? "text-red-500"
													: mbps < 1000
														? "text-amber-500"
														: "text-emerald-600 dark:text-emerald-500"
											)}
										>
											{mbps === 0 ? t`down` : formatLinkSpeed(mbps)}
										</span>
									</div>
								))}
						</div>
					)}
				</div>
				<div className="xl:ms-auto flex items-center gap-2 max-sm:-mb-1">
					<ChartTimeSelect className="w-full xl:w-40" agentVersion={chartData.agentVersion} />
					{showRestart && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									aria-label={t`Restart agent`}
									variant="outline"
									size="icon"
									className="hidden xl:flex p-0 text-primary"
									disabled={system.status !== SystemStatus.Up}
									onClick={() => setRestartOpen(true)}
								>
									<RotateCwIcon className="size-4 opacity-90" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>
								<Trans>Restart agent</Trans>
							</TooltipContent>
						</Tooltip>
					)}
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								aria-label={t`Settings`}
								variant="outline"
								size="icon"
								className="hidden xl:flex p-0 text-primary"
							>
								<Settings2Icon className="size-4 opacity-90" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="min-w-44">
							<DropdownMenuLabel className="px-3.5">
								<Trans context="Layout display options">Display</Trans>
							</DropdownMenuLabel>
							<DropdownMenuSeparator />
							<DropdownMenuRadioGroup
								className="px-1 pb-1"
								value={displayMode}
								onValueChange={(v) => setDisplayMode(v as "default" | "tabs")}
							>
								<DropdownMenuRadioItem value="default" onSelect={(e) => e.preventDefault()}>
									<Trans context="Default system layout option">Default</Trans>
								</DropdownMenuRadioItem>
								<DropdownMenuRadioItem value="tabs" onSelect={(e) => e.preventDefault()}>
									<Trans context="Tabs system layout option">Tabs</Trans>
								</DropdownMenuRadioItem>
							</DropdownMenuRadioGroup>
							<DropdownMenuSeparator />
							<DropdownMenuLabel className="px-3.5">
								<Trans>Chart width</Trans>
							</DropdownMenuLabel>
							<DropdownMenuSeparator />
							<DropdownMenuRadioGroup
								className="px-1 pb-1"
								value={grid ? "grid" : "full"}
								onValueChange={(v) => setGrid(v === "grid")}
							>
								<DropdownMenuRadioItem value="grid" onSelect={(e) => e.preventDefault()}>
									<Trans>Grid</Trans>
								</DropdownMenuRadioItem>
								<DropdownMenuRadioItem value="full" onSelect={(e) => e.preventDefault()}>
									<Trans>Full</Trans>
								</DropdownMenuRadioItem>
							</DropdownMenuRadioGroup>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
			{showRestart && (
				<AlertDialog open={restartOpen} onOpenChange={(o) => !restarting && setRestartOpen(o)}>
					<AlertDialogContent>
						<AlertDialogHeader>
							<AlertDialogTitle>
								<Trans>Restart agent on {system.name}?</Trans>
							</AlertDialogTitle>
							<AlertDialogDescription>
								<Trans>
									The agent process will exit and its supervisor (Docker or systemd) will start it again.
									Metrics for this system will be unavailable for a few seconds.
								</Trans>
							</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter>
							<AlertDialogCancel disabled={restarting}>
								<Trans>Cancel</Trans>
							</AlertDialogCancel>
							<AlertDialogAction onClick={handleRestartConfirm} disabled={restarting}>
								{restarting && <Loader2Icon className="size-4 animate-spin me-1.5" />}
								<Trans>Restart agent</Trans>
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			)}
		</Card>
	)
}
