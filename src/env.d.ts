/// <reference path="../.astro/types.d.ts" />

// Cloudflare bindings / secrets available at runtime.
interface Env {
  DISCOGS_CONSUMER_KEY: string;
  DISCOGS_CONSUMER_SECRET: string;
  SESSION_SECRET: string;
  // Optional OAuth endpoint overrides; default to the standard Discogs URLs.
  REQUEST_TOKEN_URL?: string;
  AUTHORISE_URL?: string;
  ACCESS_TOKEN_URL?: string;
}

type Runtime = import("@astrojs/cloudflare").Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {
    /** The logged-in Discogs user, or null when signed out. */
    user: import("./lib/session").SessionUser | null;
  }
}