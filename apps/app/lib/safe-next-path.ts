// Post-login redirect target: only a same-site relative path, never "//host", a scheme, or a backslash form.
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || /[\x00-\x1f]/.test(raw)) return "/";
  return raw;
}
