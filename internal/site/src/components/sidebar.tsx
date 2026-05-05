import { t } from "@lingui/core/macro"
import { Trans } from "@lingui/react/macro"
import { useStore } from "@nanostores/react"
import { getPagePath } from "@nanostores/router"
import {
	ChevronsLeftIcon,
	ChevronsRightIcon,
	ContainerIcon,
	DatabaseBackupIcon,
	HardDriveIcon,
	LayoutDashboardIcon,
	LogOutIcon,
	LogsIcon,
	MailIcon,
	MenuIcon,
	PlusIcon,
	SearchIcon,
	ServerIcon,
	SettingsIcon,
	UserIcon,
	UsersIcon,
} from "lucide-react"
import { lazy, Suspense, useState } from "react"
import { Button } from "@/components/ui/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Separator } from "@/components/ui/separator"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { isAdmin, isReadOnlyUser, logOut, pb } from "@/lib/api"
import { cn, useBrowserStorage } from "@/lib/utils"
import { AddSystemDialog } from "./add-system"
import { Logo } from "./logo"
import { ModeToggle } from "./mode-toggle"
import { $router, basePath, Link } from "./router"

const CommandPalette = lazy(() => import("./command-palette"))

const isMac = typeof navigator !== "undefined" && navigator.platform.toUpperCase().indexOf("MAC") >= 0

type NavItem = {
	label: string
	icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
	href: string
	routeKey: string
	matchSettingsName?: string
}

function getNavItems(): NavItem[] {
	return [
		{
			label: t`Dashboard`,
			icon: LayoutDashboardIcon,
			href: basePath || "/",
			routeKey: "home",
		},
		{
			label: t`Systems`,
			icon: ServerIcon,
			href: getPagePath($router, "systems"),
			routeKey: "systems",
		},
		{
			label: t`Containers`,
			icon: ContainerIcon,
			href: getPagePath($router, "containers"),
			routeKey: "containers",
		},
		{
			label: "S.M.A.R.T.",
			icon: HardDriveIcon,
			href: getPagePath($router, "smart"),
			routeKey: "smart",
		},
		{
			label: t`Settings`,
			icon: SettingsIcon,
			href: getPagePath($router, "settings", { name: "general" }),
			routeKey: "settings",
		},
	]
}

function getAdminItems(): NavItem[] {
	return [
		{
			label: t`Users`,
			icon: UsersIcon,
			href: getPagePath($router, "settings", { name: "users" }),
			routeKey: "settings",
			matchSettingsName: "users",
		},
		{
			label: t`Email`,
			icon: MailIcon,
			href: getPagePath($router, "settings", { name: "mail" }),
			routeKey: "settings",
			matchSettingsName: "mail",
		},
		{
			label: t`Backups`,
			icon: DatabaseBackupIcon,
			href: getPagePath($router, "settings", { name: "backups" }),
			routeKey: "settings",
			matchSettingsName: "backups",
		},
		{
			label: t`Activity log`,
			icon: LogsIcon,
			href: getPagePath($router, "settings", { name: "logs" }),
			routeKey: "settings",
			matchSettingsName: "logs",
		},
	]
}

function isItemActive(item: NavItem, page: ReturnType<typeof useStore<typeof $router>>): boolean {
	if (!page) return false
	if (page.route !== item.routeKey) return false
	const params = page.params as Record<string, string | undefined>
	if (item.matchSettingsName) {
		return params?.name === item.matchSettingsName
	}
	if (item.routeKey === "settings") {
		const adminNames = new Set(["users", "mail", "backups", "logs"])
		return !adminNames.has(params?.name ?? "")
	}
	return true
}

function SidebarItemLink({
	item,
	collapsed,
	active,
	onNavigate,
}: {
	item: NavItem
	collapsed: boolean
	active: boolean
	onNavigate?: () => void
}) {
	const Icon = item.icon
	const link = (
		<Link
			href={item.href}
			onClick={onNavigate}
			aria-label={item.label}
			aria-current={active ? "page" : undefined}
			className={cn(
				"flex items-center gap-3 rounded-md text-sm font-medium transition-colors",
				collapsed ? "justify-center px-2 py-2" : "px-3 py-2",
				active
					? "bg-accent text-accent-foreground"
					: "text-foreground/80 hover:bg-accent/60 hover:text-foreground"
			)}
		>
			<Icon className="size-5 shrink-0" strokeWidth={1.5} />
			{!collapsed && <span className="truncate">{item.label}</span>}
		</Link>
	)
	if (collapsed) {
		return (
			<Tooltip>
				<TooltipTrigger asChild>{link}</TooltipTrigger>
				<TooltipContent side="right">{item.label}</TooltipContent>
			</Tooltip>
		)
	}
	return link
}

function SidebarBody({
	collapsed,
	onToggleCollapsed,
	onNavigate,
	onOpenSearch,
	onOpenAddSystem,
	showCollapseButton = true,
}: {
	collapsed: boolean
	onToggleCollapsed?: () => void
	onNavigate?: () => void
	onOpenSearch: () => void
	onOpenAddSystem: () => void
	showCollapseButton?: boolean
}) {
	const page = useStore($router)
	const navItems = getNavItems()
	const adminItems = getAdminItems()
	const userEmail = pb.authStore.record?.email
	const admin = isAdmin()
	const readOnly = isReadOnlyUser()

	return (
		<div className="flex h-full flex-col">
			<div className={cn("flex items-center pt-4 pb-3", collapsed ? "justify-center px-2" : "px-4")}>
				<Link href={basePath || "/"} aria-label="Home" onClick={onNavigate} className="flex items-center">
					<Logo
						iconOnly={collapsed}
						className={cn("text-foreground", collapsed ? "h-6" : "h-7")}
					/>
				</Link>
			</div>

			<div className={cn("pb-2", collapsed ? "px-2" : "px-3")}>
				{collapsed ? (
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className="w-full"
								onClick={() => {
									onOpenSearch()
									onNavigate?.()
								}}
								aria-label={t`Search`}
							>
								<SearchIcon className="size-5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent side="right">
							{t`Search`} ({isMac ? "⌘" : "Ctrl"} K)
						</TooltipContent>
					</Tooltip>
				) : (
					<Button
						variant="outline"
						className="w-full justify-start gap-2 text-muted-foreground"
						onClick={() => {
							onOpenSearch()
							onNavigate?.()
						}}
					>
						<SearchIcon className="size-4" />
						<span className="flex-1 text-start">
							<Trans>Search</Trans>
						</span>
						<span className="ms-auto text-[10px] tracking-wider">{isMac ? "⌘" : "Ctrl"}+K</span>
					</Button>
				)}
			</div>

			<Separator />

			<nav className="flex flex-col gap-0.5 px-2 py-2">
				{navItems.map((item) => (
					<SidebarItemLink
						key={item.routeKey}
						item={item}
						collapsed={collapsed}
						active={isItemActive(item, page)}
						onNavigate={onNavigate}
					/>
				))}
			</nav>

			{admin && (
				<>
					<Separator />
					{!collapsed && (
						<p className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
							<Trans>Admin</Trans>
						</p>
					)}
					<nav className="flex flex-col gap-0.5 px-2 py-2">
						{adminItems.map((item) => (
							<SidebarItemLink
								key={item.matchSettingsName}
								item={item}
								collapsed={collapsed}
								active={isItemActive(item, page)}
								onNavigate={onNavigate}
							/>
						))}
					</nav>
				</>
			)}

			<div className="mt-auto flex flex-col gap-1 px-2 pb-3 pt-2">
				<Separator className="mb-2" />
				{!readOnly &&
					(collapsed ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="outline"
									size="icon"
									className="w-full"
									onClick={() => {
										onOpenAddSystem()
										onNavigate?.()
									}}
									aria-label={t`Add System`}
								>
									<PlusIcon className="size-5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent side="right">{t`Add System`}</TooltipContent>
						</Tooltip>
					) : (
						<Button
							variant="outline"
							className="justify-start gap-2"
							onClick={() => {
								onOpenAddSystem()
								onNavigate?.()
							}}
						>
							<PlusIcon className="size-4" />
							<span>
								<Trans>Add System</Trans>
							</span>
						</Button>
					))}
				<div className={cn("flex items-center gap-1", collapsed ? "flex-col" : "")}>
					<ModeToggle />
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button
								variant="ghost"
								size="icon"
								className={cn(collapsed ? "" : "ms-auto")}
								aria-label="User Actions"
							>
								<UserIcon className="size-5" strokeWidth={1.5} />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align={collapsed ? "start" : "end"} side={collapsed ? "right" : "top"}>
							<DropdownMenuLabel className="max-w-44 truncate">{userEmail}</DropdownMenuLabel>
							<DropdownMenuSeparator />
							<DropdownMenuItem onSelect={logOut}>
								<LogOutIcon className="me-2 size-4" />
								<Trans>Log Out</Trans>
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
				{showCollapseButton && onToggleCollapsed && (
					<Button
						variant="ghost"
						size="icon"
						className="hidden w-full md:inline-flex"
						onClick={onToggleCollapsed}
						aria-label={collapsed ? t`Expand sidebar` : t`Collapse sidebar`}
					>
						{collapsed ? <ChevronsRightIcon className="size-4" /> : <ChevronsLeftIcon className="size-4" />}
					</Button>
				)}
			</div>
		</div>
	)
}

export default function Sidebar() {
	const [collapsed, setCollapsed] = useBrowserStorage<boolean>("sidebar-collapsed", false)
	const [mobileOpen, setMobileOpen] = useState(false)
	const [searchOpen, setSearchOpen] = useState(false)
	const [addSystemOpen, setAddSystemOpen] = useState(false)

	return (
		<>
			<Suspense>
				<CommandPalette open={searchOpen} setOpen={setSearchOpen} />
			</Suspense>
			<AddSystemDialog open={addSystemOpen} setOpen={setAddSystemOpen} />

			<aside
				className={cn(
					"sticky top-0 hidden h-dvh shrink-0 border-e bg-card md:flex md:flex-col transition-[width] duration-200",
					collapsed ? "w-14" : "w-56"
				)}
			>
				<SidebarBody
					collapsed={collapsed}
					onToggleCollapsed={() => setCollapsed(!collapsed)}
					onOpenSearch={() => setSearchOpen(true)}
					onOpenAddSystem={() => setAddSystemOpen(true)}
				/>
			</aside>

			<div className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-card px-4 md:hidden">
				<Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
					<SheetTrigger asChild>
						<Button variant="ghost" size="icon" aria-label={t`Open menu`}>
							<MenuIcon />
						</Button>
					</SheetTrigger>
					<SheetContent side="left" className="w-64 p-0">
						<SheetTitle className="sr-only">Menu</SheetTitle>
						<SidebarBody
							collapsed={false}
							showCollapseButton={false}
							onNavigate={() => setMobileOpen(false)}
							onOpenSearch={() => {
								setMobileOpen(false)
								setSearchOpen(true)
							}}
							onOpenAddSystem={() => {
								setMobileOpen(false)
								setAddSystemOpen(true)
							}}
						/>
					</SheetContent>
				</Sheet>
				<Link href={basePath || "/"} aria-label="Home" className="ms-1 flex items-center">
					<Logo className="h-6 text-foreground" />
				</Link>
				<Button
					variant="ghost"
					size="icon"
					className="ms-auto"
					onClick={() => setSearchOpen(true)}
					aria-label={t`Search`}
				>
					<SearchIcon className="size-5" />
				</Button>
			</div>
		</>
	)
}
