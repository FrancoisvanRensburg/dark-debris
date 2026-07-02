import type { APIRoute } from "astro";
import { getEnv } from "../../lib/env";
import { getConsumer, getEndpoints } from "../../lib/discogs/config";
import { getAccessToken, getIdentity } from "../../lib/discogs/oauth";
import {
  OAUTH_COOKIE,
  SESSION_COOKIE,
  seal,
  unseal,
  type OAuthState,
  type SessionUser,
} from "../../lib/session";

export const prerender = false;

export const GET: APIRoute = async ({ url, cookies, redirect }) => {
  const oauthToken = url.searchParams.get("oauth_token");
  const verifier = url.searchParams.get("oauth_verifier");

  // User declined, or Discogs sent us back without the expected params.
  if (url.searchParams.get("denied") || !oauthToken || !verifier) {
    cookies.delete(OAUTH_COOKIE, { path: "/" });
    return redirect("/?login=cancelled", 302);
  }

  const sessionSecret = getEnv("SESSION_SECRET");
  const state = await unseal<OAuthState>(cookies.get(OAUTH_COOKIE)?.value ?? "", sessionSecret);

  // The returned token must match the request token we started with.
  if (!state || state.token !== oauthToken) {
    cookies.delete(OAUTH_COOKIE, { path: "/" });
    return redirect("/?login=error", 302);
  }

  const consumer = getConsumer();
  const endpoints = getEndpoints();

  try {
    const access = await getAccessToken(consumer, oauthToken, state.secret, verifier, endpoints);
    const identity = await getIdentity(consumer, access);

    const user: SessionUser = {
      username: identity.username,
      discogsId: identity.id,
      accessToken: access.token,
      accessTokenSecret: access.secret,
    };

    cookies.set(SESSION_COOKIE, await seal(user, sessionSecret), {
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
    cookies.delete(OAUTH_COOKIE, { path: "/" });

    return redirect("/", 302);
  } catch {
    cookies.delete(OAUTH_COOKIE, { path: "/" });
    return redirect("/?login=error", 302);
  }
};