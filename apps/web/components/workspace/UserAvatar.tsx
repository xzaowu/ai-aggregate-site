"use client";

import { UserRound } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useResolvedAvatarUrl } from "../../hooks/use-resolved-avatar-url";

// CC0 1.0 - notionists-neutral style by @dicebear
// https://www.dicebear.com/licenses

export interface UserAvatarProps {
  displayName?: string;
  seed?: string;
  avatarUrl?: string;
  token?: string | null;
  isGuest?: boolean;
  size?: "sm" | "md" | "lg" | "xl";
}

const BG_COLORS = [
  "bg-indigo-100 text-indigo-700",
  "bg-amber-100 text-amber-700",
  "bg-emerald-100 text-emerald-700",
  "bg-rose-100 text-rose-700",
  "bg-cyan-100 text-cyan-700",
  "bg-violet-100 text-violet-700",
  "bg-orange-100 text-orange-700",
  "bg-teal-100 text-teal-700"
];

const SIZE_CLASSES: Record<NonNullable<UserAvatarProps["size"]>, string> = {
  sm: "size-7 text-[10px]",
  md: "size-10 text-sm",
  lg: "size-12 text-base",
  xl: "size-20 text-xl"
};

function hashSeed(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    const char = seed.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function getInitial(name?: string, seed?: string): string {
  if (name && name.trim().length > 0) {
    return name.trim().charAt(0).toUpperCase();
  }
  if (seed) {
    const atIdx = seed.indexOf("@");
    const prefix = atIdx >= 0 ? seed.slice(0, atIdx) : seed;
    if (prefix.trim().length > 0) {
      return prefix.trim().charAt(0).toUpperCase();
    }
  }
  return "U";
}

function getColorClass(seed: string): string {
  const idx = hashSeed(seed) % BG_COLORS.length;
  return BG_COLORS[idx] ?? BG_COLORS[0]!;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModule = any;

let cachedDiceBearModule: AnyModule = null;
let diceBearLoadPromise: Promise<AnyModule> | null = null;

function loadDiceBearModule(): Promise<AnyModule> {
  if (cachedDiceBearModule) return Promise.resolve(cachedDiceBearModule);
  if (diceBearLoadPromise) return diceBearLoadPromise;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  diceBearLoadPromise = (async (): Promise<any> => {
    try {
      const [coreMod, styleMod] = await Promise.allSettled([
        import("@dicebear/core"),
        import("@dicebear/styles/notionists-neutral.json")
      ]);
      if (coreMod.status !== "fulfilled" || styleMod.status !== "fulfilled") {
        return null;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const styleDef = (styleMod.value as any).default ?? styleMod.value;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      cachedDiceBearModule = {
        Avatar: (coreMod.value as any).Avatar,
        Style: (coreMod.value as any).Style,
        styleDef
      };
      return cachedDiceBearModule;
    } catch {
      return null;
    }
  })();

  return diceBearLoadPromise;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generateDiceBearDataUri(seed: string, mod: any): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const style = new (mod.Style as any)(mod.styleDef);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const avatar = new (mod.Avatar as any)(style, { seed });
    return avatar.toDataUri() as string;
  } catch {
    return null;
  }
}

export function UserAvatar({
  displayName,
  seed,
  avatarUrl,
  token,
  isGuest = false,
  size = "md"
}: UserAvatarProps) {
  const effectiveSeed = seed ?? "guest";
  const sizeClass = SIZE_CLASSES[size] ?? SIZE_CLASSES.md;
  const [diceBearMod, setDiceBearMod] = useState<AnyModule>(null);
  const [diceBearDataUri, setDiceBearDataUri] = useState<string | null>(null);
  const [avatarLoadFailed, setAvatarLoadFailed] = useState(false);
  const prevSeedRef = useRef<string | null>(null);
  const { resolvedUrl } = useResolvedAvatarUrl({
    src: avatarUrl,
    token,
    enabled: !isGuest
  });

  useEffect(() => {
    if (isGuest) return;
    let cancelled = false;
    loadDiceBearModule().then((mod) => {
      if (cancelled) return;
      setDiceBearMod(mod);
    });
    return () => { cancelled = true; };
  }, [isGuest]);

  useEffect(() => {
    if (!diceBearMod || prevSeedRef.current === effectiveSeed) return;
    prevSeedRef.current = effectiveSeed;
    const uri = generateDiceBearDataUri(effectiveSeed, diceBearMod);
    setDiceBearDataUri(uri);
  }, [diceBearMod, effectiveSeed]);

  useEffect(() => {
    setAvatarLoadFailed(false);
  }, [avatarUrl]);

  const colorClass = useMemo(() => getColorClass(effectiveSeed), [effectiveSeed]);
  const initial = useMemo(() => getInitial(displayName, seed), [displayName, seed]);

  const imgClasses = `flex shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 object-cover dark:border-slate-600 dark:bg-slate-800 ${sizeClass}`;

  if (isGuest) {
    if (diceBearDataUri) {
      return (
        <img
          className={imgClasses}
          src={diceBearDataUri}
          alt="Guest avatar"
          aria-label="Guest avatar"
        />
      );
    }
    return (
      <span
        className={`flex shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-400 ${sizeClass}`}
        aria-label="Guest avatar"
      >
        <UserRound className="size-[60%]" aria-hidden="true" />
      </span>
    );
  }

  if (resolvedUrl && !avatarLoadFailed) {
    return (
      <img
        className={imgClasses}
        src={resolvedUrl}
        alt={displayName ?? "User avatar"}
        aria-label={displayName ?? "User avatar"}
        onError={() => setAvatarLoadFailed(true)}
      />
    );
  }

  if (diceBearDataUri) {
    return (
      <img
        className={imgClasses}
        src={diceBearDataUri}
        alt={displayName ?? "User avatar"}
        aria-label={displayName ?? "User avatar"}
      />
    );
  }

  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold ${colorClass} ${sizeClass}`}
      aria-label={displayName ?? "User avatar"}
    >
      {initial}
    </span>
  );
}
