"use client";

import { useEffect } from "react";
import { buildLoginRedirectUrl } from "./login-redirect";

export default function LoginPage() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    window.location.replace(buildLoginRedirectUrl(window.location.search));
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
      Redirecting...
    </div>
  );
}
