import type { APIRoute } from "astro";
import { getEnv } from "../../lib/env";
import { getConsumer, getEndpoints } from "../../lib/discogs/config";
import { authorizeUrl, getRequestToken } from "../../lib/discogs/oauth";
import { OAUTH_COOKIE, seal } from "../../lib/session";

export const prerender = false;

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const consumer = getConsumer();
  const endpoints = getEndpoints();
  const sessionSecret = getEnv("SESSION_SECRET");

  const callbackUrl = new URL("/auth/callback", url.origin).toString();
  const requestToken = await getRequestToken(consumer, callbackUrl, endpoints);

  // Stash the request token secret (encrypted) so /auth/callback can sign the
  // access-token exchange. Short-lived and cleared on callback.
  cookies.set(OAUTH_COOKIE, await seal(requestToken, sessionSecret), {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return redirect(authorizeUrl(requestToken.token, endpoints), 302);
};