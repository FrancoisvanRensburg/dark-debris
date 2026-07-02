import type { APIRoute } from "astro";
import { SESSION_COOKIE } from "../../lib/session";

export const prerender = false;

const clear: APIRoute = ({ cookies, redirect }) => {
  cookies.delete(SESSION_COOKIE, { path: "/" });
  return redirect("/", 302);
};

// GET for a plain link; POST for form-based logout.
export const GET = clear;
export const POST = clear;