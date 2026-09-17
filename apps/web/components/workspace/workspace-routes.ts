const workspaceChromeHiddenPrefixes = [
  "/admin",
  "/chat",
  "/image",
  "/video",
  "/canvas",
  "/ppt",
  "/tasks",
  "/assets"
];

export function hidesGlobalWorkspaceChrome(pathname: string | null | undefined) {
  if (!pathname) {
    return false;
  }

  return (
    pathname === "/" ||
    workspaceChromeHiddenPrefixes.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    )
  );
}
