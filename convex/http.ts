// ─── SSO via Cerulean Authentik (OIDC authorization-code flow) ─────────────
//
// The Convex site proxy (:3211) serves these HTTP actions, and the web
// container's nginx proxies /auth/* to it, so the session cookie is set on
// the app origin (works over plain HTTP on the LAN with SameSite=Lax).
//
// Routes:
//   GET /auth/login    → redirect to Authentik (state = signed, 10 min)
//   GET /auth/callback → exchange code, set plutus_session cookie, redirect home
//   GET /auth/logout   → clear cookie, redirect to Authentik end-session
//   GET /auth/me       → JSON { user } from the cookie (null when signed out)
//
// HTTP actions run in Convex's V8 runtime (no `"use node"`), so signing uses
// the Web Crypto API (crypto.subtle) rather than node:crypto.
//
// Env (set via `npx convex env set`):
//   AUTHENTIK_ISSUER       e.g. http://192.168.1.46:9000   (default http://127.0.0.1:9000)
//   AUTHENTIK_APP_SLUG     e.g. plutus                      (default plutus)
//   AUTHENTIK_CLIENT_ID / AUTHENTIK_CLIENT_SECRET  (written by scripts/provision-authentik.py)
//   AUTHENTIK_ADMIN_GROUP  default plutus-admins
//   SESSION_SECRET         HMAC key for the session cookie (required)
//   PUBLIC_URL             e.g. http://192.168.1.46:3000    (default http://127.0.0.1:3000)

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

const DAY = 86_400_000;

const auth = () => ({
  issuer: (process.env.AUTHENTIK_ISSUER || "http://127.0.0.1:9000").replace(/\/+$/, ""),
  slug: process.env.AUTHENTIK_APP_SLUG || "plutus",
  clientId: process.env.AUTHENTIK_CLIENT_ID || "",
  clientSecret: process.env.AUTHENTIK_CLIENT_SECRET || "",
  sessionSecret: process.env.SESSION_SECRET || "",
  adminGroup: process.env.AUTHENTIK_ADMIN_GROUP || "plutus-admins",
  publicUrl: (process.env.PUBLIC_URL || "http://127.0.0.1:3000").replace(/\/+$/, ""),
});

const COOKIE = "plutus_session";

// ─── Web Crypto helpers (V8 runtime — no node:crypto) ─────────
function b64url(buf: Uint8Array | ArrayBuffer): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice(0, (4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Cache the HMAC key per session-secret value (importKey is async + slow).
let hmacKey: CryptoKey | null = null;
let hmacKeyFor = "";

async function getHmacKey(): Promise<CryptoKey> {
  const secret = auth().sessionSecret;
  if (hmacKey && hmacKeyFor === secret) return hmacKey;
  hmacKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  hmacKeyFor = secret;
  return hmacKey;
}

async function sign(payload: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    "HMAC",
    await getHmacKey(),
    new TextEncoder().encode(payload),
  );
  return b64url(sig);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function signSession(user: Record<string, unknown>): Promise<string> {
  const body = b64url(new TextEncoder().encode(JSON.stringify(user)));
  return `${body}.${await sign(body)}`;
}

async function verifySession(token: string): Promise<Record<string, unknown> | null> {
  if (!auth().sessionSecret) return null;
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const expect = b64urlDecode(await sign(body));
  const got = b64urlDecode(sig);
  if (!timingSafeEqual(expect, got)) return null;
  try {
    return JSON.parse(new TextDecoder().decode(b64urlDecode(body)));
  } catch {
    return null;
  }
}

async function readSession(req: Request): Promise<Record<string, unknown> | null> {
  const header = req.headers.get("cookie") || "";
  const m = header
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(COOKIE + "="));
  if (!m) return null;
  return verifySession(m.slice(COOKIE.length + 1));
}

// ─── OIDC discovery (cached 1h) ────────────────────────────────
let discoveryCache: { exp: number; doc: Record<string, string> } | null = null;

async function discovery(): Promise<Record<string, string>> {
  const cfg = auth();
  if (discoveryCache && discoveryCache.exp > Date.now()) return discoveryCache.doc;
  const r = await fetch(
    `${cfg.issuer}/application/o/${cfg.slug}/.well-known/openid-configuration`,
    { signal: AbortSignal.timeout(8000) },
  );
  if (!r.ok) throw new Error(`authentik discovery failed: HTTP ${r.status}`);
  const doc = await r.json();
  discoveryCache = { doc, exp: Date.now() + 3_600_000 };
  return doc;
}

// ─── Login state (expiry + random + HMAC; replay-safe) ─────────
async function makeLoginState(): Promise<string> {
  const exp = Date.now() + 10 * 60 * 1000;
  const rand = b64url(crypto.getRandomValues(new Uint8Array(24)));
  return `${exp}.${rand}.${await sign("login:" + exp + ":" + rand)}`;
}

async function verifyLoginState(state: string): Promise<boolean> {
  const [expStr, rand, sig] = String(state || "").split(".");
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || !rand || !sig) return false;
  if (exp < Date.now()) return false;
  const expect = b64urlDecode(await sign("login:" + exp + ":" + rand));
  const got = b64urlDecode(sig);
  return timingSafeEqual(expect, got);
}

function userFromOidc(info: Record<string, unknown>): Record<string, unknown> {
  const groups = Array.isArray(info.groups)
    ? (info.groups as string[])
    : Array.isArray(info["goauthentik.io/groups"])
      ? (info["goauthentik.io/groups"] as string[])
      : [];
  const adminGroup = auth().adminGroup;
  return {
    sub: String(info.sub || ""),
    name: String(info.name || info.preferred_username || info.email || "Viewer"),
    email: String(info.email || ""),
    groups,
    isAdmin: groups.includes(adminGroup),
  };
}

function sessionCookie(user: Record<string, unknown>): string {
  return `${COOKIE}=${user.__signed}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * DAY}`;
}

function clearCookie(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// ─── Routes ─────────────────────────────────────────────────────

http.route({
  path: "/auth/login",
  method: "GET",
  handler: httpAction(async (_ctx, req) => {
    const cfg = auth();
    if (!cfg.clientId || !cfg.sessionSecret) {
      return new Response("SSO not configured (AUTHENTIK_CLIENT_ID / SESSION_SECRET missing)", { status: 503 });
    }
    const doc = await discovery();
    const params = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: `${cfg.publicUrl}/auth/callback`,
      response_type: "code",
      scope: "openid profile email goauthentik.io/providers/oauth2/scope-groups",
      state: await makeLoginState(),
      prompt: "login",
    });
    const next = new URL(req.url).searchParams.get("next");
    if (next) params.set("next", next);
    return new Response(null, {
      status: 302,
      headers: { Location: `${doc.authorization_endpoint}?${params.toString()}` },
    });
  }),
});

http.route({
  path: "/auth/callback",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    const cfg = auth();
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state || !(await verifyLoginState(state))) {
      return new Response("Invalid or expired login state", { status: 400 });
    }
    const doc = await discovery();
    const tokenRes = await fetch(doc.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${cfg.publicUrl}/auth/callback`,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    const tok = await tokenRes.json();
    if (!tokenRes.ok) {
      return new Response(
        `token exchange failed: ${tok.error_description || tok.error || tokenRes.status}`,
        { status: 502 },
      );
    }
    const infoRes = await fetch(doc.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${tok.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    const info = await infoRes.json();
    if (!infoRes.ok) return new Response("userinfo failed", { status: 502 });
    const user = userFromOidc(info);
    // Persist the viewer so chat/submissions can attribute to real accounts.
    try {
      await ctx.runMutation(api.channel.upsertViewer, {
        viewerId: String(user.sub),
        name: String(user.name),
        email: user.email ? String(user.email) : undefined,
        groups: (user.groups as string[]) || [],
        isAdmin: Boolean(user.isAdmin),
      });
    } catch (e) {
      console.error("upsertViewer failed:", e);
    }
    const next = url.searchParams.get("next");
    // Only allow relative redirects (no open redirect).
    const redirect = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${cfg.publicUrl}${redirect}`,
        "Set-Cookie": sessionCookie({ ...user, __signed: await signSession(user) }),
      },
    });
  }),
});

http.route({
  path: "/auth/logout",
  method: "GET",
  handler: httpAction(async (_ctx, req) => {
    const cfg = auth();
    let location = `${cfg.publicUrl}/`;
    try {
      const doc = await discovery();
      if (doc.end_session_endpoint) {
        location = `${doc.end_session_endpoint}?redirect=${encodeURIComponent(cfg.publicUrl + "/")}`;
      }
    } catch {
      // discovery down — just clear the cookie and go home
    }
    void req;
    return new Response(null, {
      status: 302,
      headers: { Location: location, "Set-Cookie": clearCookie() },
    });
  }),
});

http.route({
  path: "/auth/me",
  method: "GET",
  handler: httpAction(async (_ctx, req) => {
    const user = await readSession(req);
    return new Response(JSON.stringify({ user }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }),
});

export default http;