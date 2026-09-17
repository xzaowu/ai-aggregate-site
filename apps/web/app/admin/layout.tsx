import React from "react";
import { AdminAuthProvider } from "./admin-auth-context";
import AdminPageClient from "./admin-page-client";

export default function AdminLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <AdminAuthProvider>
      <AdminPageClient />
      {children}
    </AdminAuthProvider>
  );
}
