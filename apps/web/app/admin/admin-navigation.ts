export type AdminSectionId =
  | "overview"
  | "users"
  | "feedback"
  | "models"
  | "providerAccounts"
  | "moderation"
  | "plans"
  | "orders"
  | "payments"
  | "storageSubscriptions"
  | "settings"
  | "links"
  | "contact"
  | "operations"
  | "usage"
  | "audit";

export type AdminSidebarIconKey =
  | "overview"
  | "users"
  | "feedback"
  | "models"
  | "providerAccounts"
  | "moderation"
  | "plans"
  | "orders"
  | "payments"
  | "storageSubscriptions"
  | "settings"
  | "links"
  | "contact"
  | "operations"
  | "usage"
  | "audit";

export type AdminNavigationGroupId =
  | "customers"
  | "aiPlatform"
  | "trustSafety"
  | "commerce"
  | "siteProduct"
  | "operations";

export type AdminSettingsAreaId =
  | "brand"
  | "workspace"
  | "access"
  | "benefits";

export interface AdminNavigationGroupDefinition {
  id: AdminNavigationGroupId;
  labelKey: string;
  order: number;
}

export interface AdminSectionDefinition {
  id: AdminSectionId;
  labelKey: string;
  descriptionKey: string;
  href: string;
  routeSegment: string;
  sidebar?: {
    icon: AdminSidebarIconKey;
    labelKey: string;
    order: number;
    groupId?: AdminNavigationGroupId;
  };
}

export interface AdminSettingsAreaDefinition {
  id: AdminSettingsAreaId;
  labelKey: string;
  href: string;
  routeSegment: string | null;
}

export const adminNavigationGroups: AdminNavigationGroupDefinition[] = [
  { id: "customers", labelKey: "admin.group.customers", order: 1 },
  { id: "aiPlatform", labelKey: "admin.group.aiPlatform", order: 3 },
  { id: "trustSafety", labelKey: "admin.group.trustSafety", order: 5 },
  { id: "commerce", labelKey: "admin.group.commerce", order: 6 },
  { id: "siteProduct", labelKey: "admin.group.siteProduct", order: 10 },
  { id: "operations", labelKey: "admin.group.operations", order: 13 }
];

export const defaultAdminSection: AdminSectionId = "overview";
export const defaultAdminSettingsArea: AdminSettingsAreaId = "brand";

export const adminSettingsAreas: AdminSettingsAreaDefinition[] = [
  {
    id: "brand",
    labelKey: "admin.settingsArea.brand",
    href: "/admin/settings",
    routeSegment: null
  },
  {
    id: "workspace",
    labelKey: "admin.settingsArea.workspace",
    href: "/admin/settings/workspace",
    routeSegment: "workspace"
  },
  {
    id: "access",
    labelKey: "admin.settingsArea.access",
    href: "/admin/settings/access",
    routeSegment: "access"
  },
  {
    id: "benefits",
    labelKey: "admin.settingsArea.benefits",
    href: "/admin/settings/benefits",
    routeSegment: "benefits"
  }
];

export const adminSections: AdminSectionDefinition[] = [
  {
    id: "overview",
    labelKey: "admin.section.overview",
    descriptionKey: "admin.sectionDescription.overview",
    href: "/admin/overview",
    routeSegment: "overview",
    sidebar: { icon: "overview", labelKey: "admin.sidebar.overview", order: 0 }
  },
  {
    id: "users",
    labelKey: "admin.section.users",
    descriptionKey: "admin.sectionDescription.users",
    href: "/admin/users",
    routeSegment: "users",
    sidebar: {
      icon: "users",
      labelKey: "admin.sidebar.users",
      order: 1,
      groupId: "customers"
    }
  },
  {
    id: "feedback",
    labelKey: "admin.section.feedback",
    descriptionKey: "admin.sectionDescription.feedback",
    href: "/admin/feedback",
    routeSegment: "feedback",
    sidebar: {
      icon: "feedback",
      labelKey: "admin.sidebar.feedback",
      order: 2,
      groupId: "customers"
    }
  },
  {
    id: "models",
    labelKey: "admin.section.models",
    descriptionKey: "admin.sectionDescription.models",
    href: "/admin/models",
    routeSegment: "models",
    sidebar: {
      icon: "models",
      labelKey: "admin.sidebar.models",
      order: 3,
      groupId: "aiPlatform"
    }
  },
  {
    id: "providerAccounts",
    labelKey: "admin.section.providerAccounts",
    descriptionKey: "admin.sectionDescription.providerAccounts",
    href: "/admin/provider-accounts",
    routeSegment: "provider-accounts",
    sidebar: {
      icon: "providerAccounts",
      labelKey: "admin.sidebar.providerAccounts",
      order: 4,
      groupId: "aiPlatform"
    }
  },
  {
    id: "moderation",
    labelKey: "admin.section.moderation",
    descriptionKey: "admin.sectionDescription.moderation",
    href: "/admin/moderation",
    routeSegment: "moderation",
    sidebar: {
      icon: "moderation",
      labelKey: "admin.sidebar.moderation",
      order: 5,
      groupId: "trustSafety"
    }
  },
  {
    id: "plans",
    labelKey: "admin.section.plans",
    descriptionKey: "admin.sectionDescription.plans",
    href: "/admin/plans",
    routeSegment: "plans",
    sidebar: {
      icon: "plans",
      labelKey: "admin.sidebar.plans",
      order: 6,
      groupId: "commerce"
    }
  },
  {
    id: "orders",
    labelKey: "admin.section.orders",
    descriptionKey: "admin.sectionDescription.orders",
    href: "/admin/orders",
    routeSegment: "orders",
    sidebar: {
      icon: "orders",
      labelKey: "admin.sidebar.orders",
      order: 7,
      groupId: "commerce"
    }
  },
  {
    id: "payments",
    labelKey: "admin.paymentSettings",
    descriptionKey: "admin.sectionDescription.payments",
    href: "/admin/payments",
    routeSegment: "payments",
    sidebar: {
      icon: "payments",
      labelKey: "admin.sidebar.payments",
      order: 8,
      groupId: "commerce"
    }
  },
  {
    id: "storageSubscriptions",
    labelKey: "admin.storageSubscriptions",
    descriptionKey: "admin.sectionDescription.storageSubscriptions",
    href: "/admin/storage-subscriptions",
    routeSegment: "storage-subscriptions",
    sidebar: {
      icon: "storageSubscriptions",
      labelKey: "admin.storageSubscriptions",
      order: 9,
      groupId: "commerce"
    }
  },
  {
    id: "settings",
    labelKey: "admin.section.settings",
    descriptionKey: "admin.sectionDescription.settings",
    href: "/admin/settings",
    routeSegment: "settings",
    sidebar: {
      icon: "settings",
      labelKey: "admin.sidebar.settings",
      order: 10,
      groupId: "siteProduct"
    }
  },
  {
    id: "links",
    labelKey: "admin.section.links",
    descriptionKey: "admin.sectionDescription.links",
    href: "/admin/links",
    routeSegment: "links",
    sidebar: {
      icon: "links",
      labelKey: "admin.sidebar.links",
      order: 11,
      groupId: "siteProduct"
    }
  },
  {
    id: "contact",
    labelKey: "admin.contactSettingsTitle",
    descriptionKey: "admin.sectionDescription.contact",
    href: "/admin/contact",
    routeSegment: "contact",
    sidebar: {
      icon: "contact",
      labelKey: "admin.sidebar.contact",
      order: 12,
      groupId: "siteProduct"
    }
  },
  {
    id: "operations",
    labelKey: "admin.section.operations",
    descriptionKey: "admin.sectionDescription.operations",
    href: "/admin/operations",
    routeSegment: "operations",
    sidebar: {
      icon: "operations",
      labelKey: "admin.sidebar.operations",
      order: 13,
      groupId: "operations"
    }
  },
  {
    id: "usage",
    labelKey: "admin.section.usage",
    descriptionKey: "admin.sectionDescription.usage",
    href: "/admin/usage",
    routeSegment: "usage",
    sidebar: {
      icon: "usage",
      labelKey: "admin.sidebar.usage",
      order: 14,
      groupId: "operations"
    }
  },
  {
    id: "audit",
    labelKey: "admin.section.audit",
    descriptionKey: "admin.sectionDescription.audit",
    href: "/admin/audit",
    routeSegment: "audit",
    sidebar: {
      icon: "audit",
      labelKey: "admin.sidebar.audit",
      order: 15,
      groupId: "operations"
    }
  }
];

export const adminSidebarSections = adminSections
  .filter(
    (section): section is AdminSectionDefinition & {
      sidebar: NonNullable<AdminSectionDefinition["sidebar"]>;
    } => section.sidebar !== undefined
  )
  .sort((left, right) => left.sidebar.order - right.sidebar.order);

export function getAdminSectionDefinition(
  id: AdminSectionId
): AdminSectionDefinition {
  const definition = adminSections.find((section) => section.id === id);
  if (!definition) {
    throw new Error(`Unknown Admin section: ${id}`);
  }
  return definition;
}

export function getAdminSectionHref(id: AdminSectionId): string {
  return getAdminSectionDefinition(id).href;
}

export function getAdminNavigationGroup(
  id: AdminNavigationGroupId
): AdminNavigationGroupDefinition | null {
  return adminNavigationGroups.find((group) => group.id === id) ?? null;
}

export function getAdminSectionFromRouteSegment(
  routeSegment: string
): AdminSectionId | null {
  return (
    adminSections.find((section) => section.routeSegment === routeSegment)?.id ??
    null
  );
}

export function getAdminSectionFromPathname(
  pathname: string
): AdminSectionId | null {
  const canonicalPathname =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  const directSection =
    adminSections.find((section) => section.href === canonicalPathname)?.id ??
    null;
  if (directSection) {
    return directSection;
  }

  return getAdminSettingsAreaFromPathname(canonicalPathname)
    ? "settings"
    : null;
}

export function getAdminSettingsAreaFromRouteSegment(
  routeSegment: string
): AdminSettingsAreaId | null {
  return (
    adminSettingsAreas.find((area) => area.routeSegment === routeSegment)?.id ??
    null
  );
}

export function getAdminSettingsAreaFromPathname(
  pathname: string
): AdminSettingsAreaId | null {
  const canonicalPathname =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;
  return (
    adminSettingsAreas.find((area) => area.href === canonicalPathname)?.id ??
    null
  );
}

export function getAdminSidebarSection(
  id: AdminSectionId
): (typeof adminSidebarSections)[number] | null {
  const definition = getAdminSectionDefinition(id);
  if (!definition.sidebar) {
    return null;
  }
  return adminSidebarSections.find((section) => section.id === id) ?? null;
}
