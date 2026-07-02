/**
 * Encrypted cookie payloads via the Web Crypto API (AES‑GCM), so they work
 * identically on the Cloudflare Workers runtime and in `astro dev` (Node 20+).
 *
 * `seal` returns an opaque base64url string; `unseal` returns null on any
 * tampering / wrong key / malformed input rather than throwing.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

/** The authenticated user, stored in the session cookie. */
export interface SessionUser {
  username: string;
  discogsId: number;
  // Access token kept server-side only (cookie is httpOnly + encrypted); needed
  // to call the Discogs API on the user's behalf in later PRs.
  accessToken: string;
  accessTokenSecret: string;
}

/** Short-lived state stored between /auth/login and /auth/callback. */
export interface OAuthState {
  token: string;
  secret: string;
}

async function keyFromSecret(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  return crypto.subtle.importKey("raw", hash, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function seal(data: unknown, secret: string): Promise<string> {
  const key = await keyFromSecret(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(data))),
  );
  const out = new Uint8Array(iv.length + ciphertext.length);
  out.set(iv);
  out.set(ciphertext, iv.length);
  return toBase64Url(out);
}

export async function unseal<T>(token: string, secret: string): Promise<T | null> {
  if (!token) return null;
  try {
    const raw = fromBase64Url(token);
    const iv = raw.slice(0, 12);
    const ciphertext = raw.slice(12);
    const key = await keyFromSecret(secret);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
    return JSON.parse(dec.decode(plaintext)) as T;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = "dd_session";
export const OAUTH_COOKIE = "dd_oauth";