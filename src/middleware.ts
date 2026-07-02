import { defineMiddleware } from "astro:middleware";
import { getEnv } from "./lib/env";
import { SESSION_COOKIE, unseal, type SessionUser } from "./lib/session";

export const onRequest = defineMiddleware(async (context, next) => {
  context.locals.user = null;

  const cookie = context.cookies.get(SESSION_COOKIE)?.value;
  if (cookie) {
    try {
      const user = await unseal<SessionUser>(cookie, getEnv("SESSION_SECRET"));
      if (user) context.locals.user = user;
    } catch {
      // Missing SESSION_SECRET or malformed cookie → treat as signed out.
    }
  }

  return next();
});