/**
 * Discogs OAuth 1.0a — PLAINTEXT signature flow.
 *
 * Discogs supports the PLAINTEXT signature method over HTTPS, so we avoid
 * HMAC‑SHA1 entirely: the signature is just `consumerSecret&tokenSecret`.
 *
 * Flow:
 *   1. getRequestToken()  → temporary request token + secret
 *   2. authorizeUrl()     → send the user to Discogs to approve
 *   3. getAccessToken()   → exchange the verifier for a long‑lived access token
 *   4. discogsGet()/getIdentity() → authenticated API calls
 *
 * All requests must send a User-Agent (Discogs rejects requests without one).
 */

const API = "https://api.discogs.com";
const USER_AGENT = "DarkDebrisRatings/1.0 +https://github.com/FrancoisvanRensburg";

/** OAuth endpoint URLs (overridable via env; default to Discogs). */
export interface Endpoints {
  requestToken: string;
  authorize: string;
  accessToken: string;
}

export const DEFAULT_ENDPOINTS: Endpoints = {
  requestToken: `${API}/oauth/request_token`,
  authorize: "https://www.discogs.com/oauth/authorize",
  accessToken: `${API}/oauth/access_token`,
};

export interface Consumer {
  key: string;
  secret: string;
}

export interface Token {
  token: string;
  secret: string;
}

function oauthHeader(params: Record<string, string>): string {
  const parts = Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}="${encodeURIComponent(v)}"`)
    .join(", ");
  return `OAuth ${parts}`;
}

function baseParams(consumerKey: string): Record<string, string> {
  return {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""),
    oauth_signature_method: "PLAINTEXT",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: "1.0",
  };
}

/** PLAINTEXT signature: consumer secret & token secret (empty for step 1). */
function sign(consumerSecret: string, tokenSecret = ""): string {
  return `${consumerSecret}&${tokenSecret}`;
}

function parseTokenResponse(body: string): Token {
  const data = new URLSearchParams(body);
  const token = data.get("oauth_token");
  const secret = data.get("oauth_token_secret");
  if (!token || !secret) throw new Error(`Unexpected OAuth response: ${body}`);
  return { token, secret };
}

/** Step 1: obtain a request token, telling Discogs where to send the user back. */
export async function getRequestToken(
  consumer: Consumer,
  callbackUrl: string,
  endpoints: Endpoints = DEFAULT_ENDPOINTS,
): Promise<Token> {
  const params = {
    ...baseParams(consumer.key),
    oauth_callback: callbackUrl,
    oauth_signature: sign(consumer.secret),
  };
  const res = await fetch(endpoints.requestToken, {
    headers: { Authorization: oauthHeader(params), "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`request_token failed (${res.status}): ${await res.text()}`);
  return parseTokenResponse(await res.text());
}

/** Step 2: the URL to send the user to so they can approve access. */
export function authorizeUrl(requestToken: string, endpoints: Endpoints = DEFAULT_ENDPOINTS): string {
  return `${endpoints.authorize}?oauth_token=${encodeURIComponent(requestToken)}`;
}

/** Step 3: exchange the approved request token + verifier for an access token. */
export async function getAccessToken(
  consumer: Consumer,
  requestToken: string,
  requestTokenSecret: string,
  verifier: string,
  endpoints: Endpoints = DEFAULT_ENDPOINTS,
): Promise<Token> {
  const params = {
    ...baseParams(consumer.key),
    oauth_token: requestToken,
    oauth_verifier: verifier,
    oauth_signature: sign(consumer.secret, requestTokenSecret),
  };
  const res = await fetch(endpoints.accessToken, {
    method: "POST",
    headers: { Authorization: oauthHeader(params), "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`access_token failed (${res.status}): ${await res.text()}`);
  return parseTokenResponse(await res.text());
}

/** Authenticated GET against the Discogs API using an access token. */
export function discogsGet(consumer: Consumer, access: Token, path: string): Promise<Response> {
  const params = {
    ...baseParams(consumer.key),
    oauth_token: access.token,
    oauth_signature: sign(consumer.secret, access.secret),
  };
  return fetch(`${API}${path}`, {
    headers: { Authorization: oauthHeader(params), "User-Agent": USER_AGENT },
  });
}

export interface Identity {
  id: number;
  username: string;
}

/** Who is the access token for? Used to key the user's library later. */
export async function getIdentity(consumer: Consumer, access: Token): Promise<Identity> {
  const res = await discogsGet(consumer, access, "/oauth/identity");
  if (!res.ok) throw new Error(`identity failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as Identity;
}