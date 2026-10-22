import { next } from "@vercel/functions";
import { NextResponse } from "next/server";
import session from "./lib/turnstile-session.js";

const PUBLIC_PATHS = new Set([
  "/turnstile-gate.html",
  "/api/turnstile/verify",
  "/api/turnstile/signout"
]);

export const config = {
  matcher: ["/:path*"]
};

export default function proxy(request: Request & { nextUrl?: URL; cookies?: any }) {
  const url = new URL(request.url);

  const ua = request.headers.get("user-agent") || "";
  const host = url.host;

  // ✅ Bypass Turnstile for Roblox requests
  if (
    ua.includes("Roblox") ||
    host.includes("roblox-orbit.vercel.app")
  ) {
    return next();
  }

  // Allow public paths
  if (PUBLIC_PATHS.has(url.pathname)) {
    return next();
  }

  const secret = process.env.ORBIT_SESSION_SECRET;

  if (!secret || secret.length < 32) {
    return new Response(
      "Website access is temporarily unavailable.",
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/plain; charset=utf-8"
        }
      }
    );
  }

  const cookieHeader = request.headers.get("cookie") || "";

  const cookie = cookieHeader
    .split(";")
    .map(part => part.trim())
    .find(part =>
      part.startsWith(`${session.COOKIE_NAME}=`)
    );

  const token = cookie
    ? cookie.slice(session.COOKIE_NAME.length + 1)
    : null;

  // ✅ Valid Turnstile session
  if (session.isValidSession(token, secret)) {
    return next();
  }

  // ✅ API requests return JSON error
  if (url.pathname.startsWith("/api/")) {
    return Response.json(
      { error: "turnstile_required" },
      {
        status: 403,
        headers: {
          "Cache-Control": "no-store"
        }
      }
    );
  }

  // ✅ Redirect browser to Turnstile page
  const gateUrl = new URL("/turnstile-gate.html", url);

  gateUrl.searchParams.set(
    "next",
    `${url.pathname}${url.search}`
  );

  return new Response(null, {
    status: 307,
    headers: {
      "Cache-Control": "no-store",
      Location: gateUrl.toString()
    }
  });
}
