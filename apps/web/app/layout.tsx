import type { Metadata } from "next";
import React from "react";
import { MaintenanceBanner } from "../components/MaintenanceBanner";
import { SiteTitleUpdater } from "../components/SiteTitleUpdater";
import { I18nProvider } from "../lib/i18n/i18n-provider";
import { DEFAULT_DOCUMENT_TITLE } from "../lib/site-title";
import "./globals.css";

export const metadata: Metadata = {
  title: DEFAULT_DOCUMENT_TITLE,
  description: "Multi-model AI aggregate site MVP"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=window.localStorage.getItem("ai-aggregate:theme");if(t==="dark"){document.documentElement.classList.add("dark")}}catch(e){}})()`
          }}
        />
      </head>
      <body className="min-h-screen antialiased">
        <I18nProvider>
          <SiteTitleUpdater />
          <MaintenanceBanner />
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
