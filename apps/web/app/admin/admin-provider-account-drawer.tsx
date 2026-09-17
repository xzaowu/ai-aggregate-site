"use client";

import React from "react";
import { useI18n } from "../../lib/i18n/use-i18n";
import {
  AdminDrawer,
  AdminDrawerBody,
  AdminDrawerFooter,
  AdminDrawerHeader
} from "./admin-layout";

interface AdminProviderAccountDrawerProps {
  title: string;
  description: string;
  open: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
  iconButtonClass: string;
  onClose: () => void;
}

export function AdminProviderAccountDrawer({
  title,
  description,
  open,
  children,
  footer,
  iconButtonClass,
  onClose
}: AdminProviderAccountDrawerProps) {
  const { t } = useI18n();
  const closeLabel = t("admin.closeProviderAccountDrawer");

  return (
    <AdminDrawer open={open} onClose={onClose} closeLabel={closeLabel}>
      <AdminDrawerHeader
        closeLabel={closeLabel}
        description={description}
        iconButtonClass={iconButtonClass}
        title={title}
        onClose={onClose}
      />
      <AdminDrawerBody>{children}</AdminDrawerBody>
      {footer ? <AdminDrawerFooter>{footer}</AdminDrawerFooter> : null}
    </AdminDrawer>
  );
}
