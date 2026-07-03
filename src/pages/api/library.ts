import type { APIRoute } from "astro";
import { getConsumer } from "../../lib/discogs/config";
import { fetchLibrary } from "../../lib/discogs/library";

export const prerender = false;

/**
 * Returns the logged-in user's Discogs wantlist + collection, normalised and
 * tagged `wanted`/`owned`. 401 when signed out. The access token lives only in
 * the encrypted session cookie (populated by middleware into `locals.user`).
 */
export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) {
    return Response.json({ error: "not_authenticated" }, { status: 401 });
  }

  const consumer = getConsumer();
  const access = { token: user.accessToken, secret: user.accessTokenSecret };

  try {
    const library = await fetchLibrary(consumer, access, user.username);
    return Response.json(library, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return Response.json({ error: "fetch_failed", message }, { status: 502 });
  }
};
