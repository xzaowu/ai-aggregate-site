import {
  BadgeDollarSign,
  Brain,
  FileType,
  FolderOpen,
  HelpCircle,
  Image as ImageIcon,
  Link as LinkIcon,
  ListTodo,
  MessageSquare,
  MessageSquarePlus,
  PanelsTopLeft,
  ShieldCheck,
  Sparkles,
  UserRound,
  Video,
  type LucideIcon
} from "lucide-react";
export type WorkspacePanel = "models" | "plans" | "account" | "feedback" | "links" | null;

export type WorkspaceNavKey =
  | "chat"
  | "image"
  | "video"
  | "canvas"
  | "ppt"
  | "tasks"
  | "assets"
  | "models"
  | "inspiration"
  | "plans"
  | "feedback"
  | "help"
  | "account"
  | "links"
  | "admin";

export const workspaceNavIconMap: Record<WorkspaceNavKey, LucideIcon> = {
  chat: MessageSquare,
  image: ImageIcon,
  video: Video,
  canvas: PanelsTopLeft,
  ppt: FileType,
  tasks: ListTodo,
  assets: FolderOpen,
  models: Brain,
  inspiration: Sparkles,
  plans: BadgeDollarSign,
  feedback: MessageSquarePlus,
  help: HelpCircle,
  account: UserRound,
  links: LinkIcon,
  admin: ShieldCheck
};

export function getWorkspaceNavIcon(key: WorkspaceNavKey): LucideIcon {
  return workspaceNavIconMap[key];
}

export type WorkspaceNavItemConfig = {
  key: WorkspaceNavKey;
  labelKey: string;
  shortLabelKey?: string;
  icon: WorkspaceNavKey;
  href?: string;
  comingSoon?: boolean;
  adminOnly?: boolean;
};

export type WorkspaceNavSectionConfig = {
  key: "creation" | "management" | "service" | "more";
  labelKey: string;
  items: WorkspaceNavItemConfig[];
};

export const workspaceCreationNavItems: WorkspaceNavItemConfig[] = [
  {
    key: "chat",
    labelKey: "workspace.chat",
    icon: "chat",
    href: "/"
  },
  {
    key: "image",
    labelKey: "workspace.imageNav",
    shortLabelKey: "workspace.image",
    icon: "image",
    href: "/image"
  },
  {
    key: "video",
    labelKey: "workspace.videoNav",
    icon: "video",
    href: "/video"
  },
  {
    key: "canvas",
    labelKey: "workspace.canvasNav",
    icon: "canvas",
    href: "/canvas"
  }
];

export type WorkspaceCreationSurfaceKey = "image" | "video" | "canvas";

export type WorkspaceCreationSurfaceNavItem = WorkspaceNavItemConfig & {
  key: WorkspaceCreationSurfaceKey;
  href: string;
};

export const workspaceCreationSurfaceNavItems = workspaceCreationNavItems.filter(
  (item): item is WorkspaceCreationSurfaceNavItem =>
    item.key === "image" || item.key === "video" || item.key === "canvas"
);

export const workspaceManagementNavItems: WorkspaceNavItemConfig[] = [
  {
    key: "tasks",
    labelKey: "workspace.tasksNav",
    shortLabelKey: "workspace.tasksShort",
    icon: "tasks",
    href: "/tasks"
  },
  {
    key: "assets",
    labelKey: "workspace.assetsNav",
    shortLabelKey: "workspace.assetsShort",
    icon: "assets",
    href: "/assets"
  }
];

export const workspaceServiceNavItems: WorkspaceNavItemConfig[] = [
  {
    key: "inspiration",
    labelKey: "workspace.inspiration",
    icon: "chat",
    comingSoon: true
  },
  {
    key: "models",
    labelKey: "workspace.models",
    icon: "models",
    href: "/models"
  },
  {
    key: "plans",
    labelKey: "workspace.plansNav",
    icon: "plans",
    href: "/plans"
  },
  {
    key: "links",
    labelKey: "workspace.linksNav",
    icon: "links",
    href: "/links"
  }
];

export const workspaceMoreNavItems: WorkspaceNavItemConfig[] = [
  {
    key: "feedback",
    labelKey: "workspace.feedback",
    icon: "feedback",
    href: "/feedback"
  },
  {
    key: "help",
    labelKey: "nav.help",
    icon: "help",
    href: "/help"
  },
  {
    key: "account",
    labelKey: "nav.account",
    icon: "account",
    href: "/account"
  },
  {
    key: "links",
    labelKey: "workspace.linksNav",
    icon: "links",
    href: "/links"
  },
  {
    key: "admin",
    labelKey: "workspace.adminPanel",
    icon: "account",
    href: "/admin",
    adminOnly: true
  }
];



export type MobileWorkspaceNavKey = "chat" | "creation" | "works" | "account";

export type MobileWorkspaceNavItem = {
  key: MobileWorkspaceNavKey;
  labelKey: string;
  icon: WorkspaceNavKey;
  href: string;
};

export const mobileBottomWorkspaceNavItems: MobileWorkspaceNavItem[] = [
  {
    key: "chat",
    labelKey: "workspace.mobile.chat",
    icon: "chat",
    href: "/"
  },
  {
    key: "creation",
    labelKey: "workspace.mobile.creation",
    icon: "image",
    href: "/image"
  },
  {
    key: "works",
    labelKey: "workspace.mobile.works",
    icon: "assets",
    href: "/assets"
  },
  {
    key: "account",
    labelKey: "workspace.mobile.account",
    icon: "account",
    href: "/account"
  }
];

const PANEL_ROUTE_MAP: Record<NonNullable<WorkspacePanel>, string> = {
  models: "/models",
  plans: "/plans",
  account: "/account",
  feedback: "/feedback",
  links: "/links"
};

export function getWorkspacePanelUrl(panel: WorkspacePanel): string {
  if (!panel) {
    return "/";
  }

  return PANEL_ROUTE_MAP[panel];
}

export function getWorkspacePanelFromPathname(
  pathname: string
): NonNullable<WorkspacePanel> | null {
  for (const [panel, route] of Object.entries(PANEL_ROUTE_MAP)) {
    if (pathname === route || pathname.startsWith(`${route}/`)) {
      return panel as NonNullable<WorkspacePanel>;
    }
  }

  return null;
}

export function getWorkspaceActiveKey(
  pathname: string,
  activePanel: WorkspacePanel = null
): WorkspaceNavKey | "more" | null {
  // Clean routes for former query-panel pages
  const routePanel = getWorkspacePanelFromPathname(pathname);
  if (routePanel) {
    return routePanel;
  }

  if (activePanel) {
    return activePanel;
  }

  if (pathname === "/" || pathname === "/chat" || pathname.startsWith("/chat/")) {
    return "chat";
  }

  if (pathname === "/image" || pathname.startsWith("/image/")) return "image";
  if (pathname === "/canvas" || pathname.startsWith("/canvas/")) return "canvas";
  if (pathname === "/video/workspace") return "canvas";
  if (pathname === "/video" || pathname.startsWith("/video/")) return "video";
  if (pathname === "/ppt" || pathname.startsWith("/ppt/")) return "ppt";
  if (pathname === "/tasks" || pathname.startsWith("/tasks/")) return "tasks";
  if (pathname === "/assets" || pathname.startsWith("/assets/")) return "assets";
  if (pathname === "/help" || pathname.startsWith("/help/")) return "help";
  if (pathname === "/pricing" || pathname.startsWith("/pricing/")) return "plans";
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return "admin";

  return null;
}

export function getWorkspaceMobileNavKey(
  pathname: string,
  activePanel: WorkspacePanel = null
): MobileWorkspaceNavKey | null {
  const activeKey = getWorkspaceActiveKey(pathname, activePanel);

  if (activeKey === "chat") {
    return "chat";
  }

  if (
    activeKey === "image" ||
    activeKey === "video" ||
    activeKey === "canvas" ||
    activeKey === "ppt"
  ) {
    return "creation";
  }

  if (activeKey === "tasks" || activeKey === "assets") {
    return "works";
  }

  if (
    activeKey === "account" ||
    activeKey === "models" ||
    activeKey === "plans" ||
    activeKey === "feedback" ||
    activeKey === "help" ||
    activeKey === "links"
  ) {
    return "account";
  }

  return null;
}

export function isWorkspaceMobileNavItemActive(
  item: Pick<MobileWorkspaceNavItem, "key">,
  pathname: string,
  activePanel: WorkspacePanel = null
): boolean {
  return item.key === getWorkspaceMobileNavKey(pathname, activePanel);
}

export function isWorkspaceNavItemActive(
  item: { key: WorkspaceNavKey },
  pathname: string,
  activePanel: WorkspacePanel = null
) {
  const activeKey = getWorkspaceActiveKey(pathname, activePanel);

  return item.key === activeKey;
}
