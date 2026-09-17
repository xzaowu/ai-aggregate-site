"use client";

import { useRouter } from "next/navigation";
import React, { Suspense, useEffect, useState } from "react";
import { ChatWorkspace } from "../../components/workspace/ChatWorkspace";
import { apiUrl } from "../../lib/site-config";

function SetupGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function check() {
      try {
        const res = await fetch(apiUrl("/setup/status"));
        const data = (await res.json()) as { setupCompleted: boolean };

        if (!cancelled) {
          if (!data.setupCompleted) {
            router.replace("/setup");
          } else {
            setReady(true);
          }
        }
      } catch {
        if (!cancelled) setReady(true); // Allow access if API is unavailable
      }
    }

    void check();
    return () => { cancelled = true; };
  }, [router]);

  if (!ready) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-slate-50">
        <div className="size-8 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}

export default function HomePage() {
  return (
    <Suspense>
      <SetupGuard>
        <ChatWorkspace />
      </SetupGuard>
    </Suspense>
  );
}
