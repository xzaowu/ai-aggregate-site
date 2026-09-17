export function buildLoginRedirectUrl(search: string): string {
  const params = new URLSearchParams(search);
  const auth = params.get("auth") || "login";
  const returnTo = params.get("returnTo");
  const redirectParams = new URLSearchParams({ auth });
  if (returnTo) redirectParams.set("returnTo", returnTo);
  return `/?${redirectParams.toString()}`;
}
