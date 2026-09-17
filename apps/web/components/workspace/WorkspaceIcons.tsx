"use client";

import React from "react";

/**
 * Unified workspace icon set (inline SVG).
 *
 * Every icon is exactly 20×20 px (viewBox) and fills via `currentColor`.
 * Sizes are controlled by the parent via `w-5 h-5` (20 px) or `w-[18px] h-[18px]`.
 * Do NOT mix emoji, raw letters, or third-party icon-lib icons for sidebar nav entries.
 */

export type WorkspaceIconName =
  | "chat"
  | "image"
  | "video"
  | "ppt"
  | "tasks"
  | "assets"
  | "models"
  | "plans"
  | "help"
  | "feedback"
  | "account"
  | "links"
  | "themeLight"
  | "themeDark"
  | "languageGlobe"
  | "creditCard";

function IconShell({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      role="img"
      aria-label={label}
    >
      {children}
    </svg>
  );
}

function ChatIcon() {
  return (
    <IconShell label="Chat">
      <path
        d="M4 2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8l-3.5 3V12a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="8" r="1" fill="currentColor" />
      <circle cx="10" cy="8" r="1" fill="currentColor" />
      <circle cx="13" cy="8" r="1" fill="currentColor" />
    </IconShell>
  );
}

function ImageIcon() {
  return (
    <IconShell label="Image">
      <rect
        x="2.5"
        y="3.5"
        width="15"
        height="13"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7.5" cy="8" r="1.5" fill="currentColor" />
      <path
        d="M2.5 14l4.5-4 3 2.5L14.5 8l3 3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconShell>
  );
}

function VideoIcon() {
  return (
    <IconShell label="Video">
      <rect
        x="2"
        y="4"
        width="11"
        height="12"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M13 9.5 18 6v8l-5-3.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconShell>
  );
}

function PptIcon() {
  return (
    <IconShell label="PPT">
      <path
        d="M5 2h6l5 5v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M11 2v5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <text x="6.5" y="15" fontSize="6" fontWeight="700" fill="currentColor">
        P
      </text>
    </IconShell>
  );
}

function TasksIcon() {
  return (
    <IconShell label="Tasks">
      {/* Clipboard board */}
      <rect
        x="3"
        y="2.5"
        width="14"
        height="15"
        rx="2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Top clip */}
      <rect
        x="7"
        y="1"
        width="6"
        height="3"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Check 1 */}
      <path
        d="M5.5 9l1.5 1.5 2.5-3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M11 9.5h4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      {/* Check 2 */}
      <path
        d="M5.5 13.5l1.5 1.5 2.5-3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M11 14h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </IconShell>
  );
}

function AssetsIcon() {
  return (
    <IconShell label="Assets">
      {/* Folder body */}
      <path
        d="M2 5.5a2 2 0 0 1 2-2h4l2 1.5h6a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      {/* Image inside folder */}
      <rect
        x="5.5"
        y="8"
        width="8"
        height="5.5"
        rx="1"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
      {/* Landscape line */}
      <path
        d="M5.5 12l2.5-1.5 1.5 1 2-1.5 2 1"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconShell>
  );
}

function ModelsIcon() {
  return (
    <IconShell label="Models">
      <path
        d="M10 2a6 6 0 0 0-6 6v3a2 2 0 0 0 2 2h1a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H5.3A4.7 4.7 0 0 1 10 3.5a4.7 4.7 0 0 1 4.7 4.5H13a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h1a2 2 0 0 0 2-2V8a6 6 0 0 0-6-6z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconShell>
  );
}

function PlansIcon() {
  return (
    <IconShell label="Plans">
      <path
        d="M10 2 3 6l7 4 7-4-7-4z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M3 11.5 10 15.5 17 11.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 15.5 10 18.5 17 15.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="3" y1="6" x2="3" y2="11.5" stroke="currentColor" strokeWidth="1.2" />
      <line x1="17" y1="6" x2="17" y2="11.5" stroke="currentColor" strokeWidth="1.2" />
    </IconShell>
  );
}

function HelpIcon() {
  return (
    <IconShell label="Help">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M8 8a2 2 0 0 1 2-1.5 2 2 0 0 1 2 2.5c-.3.6-1 1.2-1.5 1.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="10" cy="14" r="0.8" fill="currentColor" />
    </IconShell>
  );
}

function FeedbackIcon() {
  return (
    <IconShell label="Feedback">
      <path
        d="M14 2H6a2 2 0 0 0-2 2v10l3-3h7a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8 7h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M8 10h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </IconShell>
  );
}

function AccountIcon() {
  return (
    <IconShell label="Account">
      <circle cx="10" cy="7" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M3.5 17.5c0-3 2.5-5.5 6.5-5.5s6.5 2.5 6.5 5.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </IconShell>
  );
}

function LinksIcon() {
  return (
    <IconShell label="Links">
      <path
        d="M9 4H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M17 3h-4v4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8.5 11.5 16 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </IconShell>
  );
}

function ThemeLightIcon() {
  return (
    <IconShell label="Light mode">
      <circle cx="10" cy="10" r="3.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 2v1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M10 16.5V18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4.34 4.34l1.06 1.06" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14.6 14.6l1.06 1.06" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M2 10h1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M16.5 10H18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </IconShell>
  );
}

function ThemeDarkIcon() {
  return (
    <IconShell label="Dark mode">
      <path
        d="M17.5 13A7.5 7.5 0 0 1 11 3.5a6 6 0 1 0 0 13 7.5 7.5 0 0 0 6.5-3.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </IconShell>
  );
}

function LanguageGlobeIcon() {
  return (
    <IconShell label="Language">
      <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.5 10h13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path
        d="M10 3.5A9.7 9.7 0 0 1 13.5 10 9.7 9.7 0 0 1 10 16.5 9.7 9.7 0 0 1 6.5 10 9.7 9.7 0 0 1 10 3.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </IconShell>
  );
}

function CreditCardIcon() {
  return (
    <IconShell label="Credit">
      <rect x="2.5" y="4.5" width="15" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.5 8.5h15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </IconShell>
  );
}

const iconMap: Record<WorkspaceIconName, React.ComponentType> = {
  chat: ChatIcon,
  image: ImageIcon,
  video: VideoIcon,
  ppt: PptIcon,
  tasks: TasksIcon,
  assets: AssetsIcon,
  models: ModelsIcon,
  plans: PlansIcon,
  help: HelpIcon,
  feedback: FeedbackIcon,
  account: AccountIcon,
  links: LinksIcon,
  themeLight: ThemeLightIcon,
  themeDark: ThemeDarkIcon,
  languageGlobe: LanguageGlobeIcon,
  creditCard: CreditCardIcon,
};

export function WorkspaceIcon({
  name,
  className = "w-5 h-5 shrink-0",
}: {
  name: WorkspaceIconName;
  className?: string;
}) {
  const C = iconMap[name];
  if (!C) {
    return (
      <span className={className} aria-hidden="true">
        ·
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center justify-center ${className}`}>
      <C />
    </span>
  );
}

export const WORKSPACE_ICON_NAMES = Object.keys(iconMap) as WorkspaceIconName[];