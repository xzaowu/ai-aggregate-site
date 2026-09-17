import React, { Suspense } from "react";
import { WorkspaceLayoutClient } from "./workspace-layout-client";

export default function WorkspaceLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={null}>
      <WorkspaceLayoutClient gateUntilHydrated>
        {children}
      </WorkspaceLayoutClient>
    </Suspense>
  );
}
