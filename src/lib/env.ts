// Cloudflare bindings/secrets are read from the `cloudflare:workers` virtual
// module (replaces the removed `Astro.locals.runtime.env`). In dev these come
// from `.dev.vars`; in production from Worker vars/secrets.
import { env } from "cloudflare:workers";

type EnvRecord = Record<string, string | undefined>;

export function getEnvOptional(key: keyof Env): string | undefined {
  return (env as unknown as EnvRecord)[key as string];
}

export function getEnv(key: keyof Env): string {
  const value = getEnvOptional(key);
  if (!value) throw new Error(`Missing required environment variable: ${String(key)}`);
  return value;
}