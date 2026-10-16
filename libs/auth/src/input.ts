/** The form an email address is stored and compared in. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Whether `path` is safe to redirect to after sign-in: a path on this origin.
 * `startsWith("/")` alone is not enough (ucmc's bug): `//evil.com` and
 * `/\evil.com` are protocol-relative URLs to another host, so a second `/` or
 * `\` is refused, as is anything with control characters, which browsers strip
 * before parsing.
 */
export function isSafeRedirect(path: string): boolean {
  if (path.length > 2048) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point.
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  return /^\/(?![/\\])/.test(path);
}
