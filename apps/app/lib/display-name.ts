export type DisplayNameResult = { ok: true; name: string; key: string } | { ok: false; error: string };

const ALLOWED = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,39}$/u;

// `key` is the case-insensitive uniqueness key; `name` is what gets shown.
export function normalizeDisplayName(raw: string): DisplayNameResult {
  const nfkc = raw.normalize("NFKC");
  // Checked before whitespace collapsing, which would otherwise turn \n or \t into a plain space.
  if (/\p{Cc}/u.test(nfkc)) return { ok: false, error: "Display name can't contain control characters." };
  const name = nfkc.trim().replace(/ +/g, " ");
  if (!ALLOWED.test(name)) {
    return { ok: false, error: "Use 1-40 letters, numbers, spaces, dots, dashes or underscores, starting with a letter or number." };
  }
  return { ok: true, name, key: name.toLowerCase() };
}
