/**
 * Secret tokens: magic links, session cookies, WebAuthn ceremony ids.
 *
 * 32 bytes from the platform CSPRNG, as base64url (43 characters, no
 * padding). Never a newId(): a UUIDv7 reveals when it was made and has far
 * fewer random bits. Only `hashToken(token)` is stored, so a copy of the
 * database can't be replayed as a sign-in.
 */

const TOKEN_BYTES = 32;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** A new random token. */
export function randomToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/** SHA-256 of `token`, as base64url: the form tokens are stored and looked up in. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return toBase64Url(new Uint8Array(digest));
}
