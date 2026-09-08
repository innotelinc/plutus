// PLUTUS SSO login UX check — drives chrome-headless-shell directly over CDP
// (no dependencies; Node's built-in fetch + WebSocket) and confirms a real
// browser can sign in through Cerulean Authentik and land back with a
// plutus_session cookie, then read the session via /auth/me.
//
// Env:
//   CHROME_PATH  chrome-headless-shell binary (required)
//   AUTH_USER    Authentik username (required)
//   AUTH_PASS    Authentik password (required)
//   AUTH_APP     app origin (default http://192.168.1.46:3000)
//   AUTH_BASE    Authentik origin (default http://192.168.1.46:9000)
//
// Exits non-zero when the check fails.

import { spawn } from "node:child_process";
import fs from "node:fs";

const CHROME = process.env.CHROME_PATH;
if (!CHROME) {
  console.error("[auth] CHROME_PATH not set");
  process.exit(1);
}
const USER = process.env.AUTH_USER;
const PASS = process.env.AUTH_PASS;
if (!USER || !PASS) {
  console.error("[auth] AUTH_USER / AUTH_PASS not set");
  process.exit(1);
}
const APP = (process.env.AUTH_APP || "http://192.168.1.46:3000").replace(/\/+$/, "");
const BASE = (process.env.AUTH_BASE || "http://192.168.1.46:9000").replace(/\/+$/, "");

async function pickPort(start) {
  for (let port = start; port < start + 10; port++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(300),
      });
      if (res.ok) continue;
    } catch {
      return port;
    }
  }
  throw new Error(`No free debug port in range ${start}..${start + 9}`);
}

const PORT = await pickPort(9540);
const USER_DATA_DIR = fs.mkdtempSync("/tmp/chrome-auth-check-");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const proc = spawn(
  CHROME,
  [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${USER_DATA_DIR}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

try {
  let devtools;
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) {
        devtools = await r.json();
        break;
      }
    } catch {}
    await sleep(250);
  }
  if (!devtools) throw new Error("Chrome DevTools endpoint did not come up");

  const page = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error("ws error"));
  });

  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  };

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evalJs = async (expression) => {
    const res = await Promise.race([
      send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }),
      sleep(15000).then(() => null),
    ]);
    if (!res) return { evalError: "evaluate timed out" };
    if (res.exceptionDetails) return { evalError: res.exceptionDetails.text };
    return res.result?.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");

  console.log(`[auth] navigating to ${APP}/auth/login?next=/`);
  await send("Page.navigate", { url: `${APP}/auth/login?next=/` });
  await sleep(4000);

  // Fill one Authentik stage field (shadow-piercing: Authentik renders its flow
  // inside web components) and click its submit button.
  const fillAndSubmit = (name, value) =>
    evalJs(`(async () => {
      const all = (root) => {
        const els = [...root.querySelectorAll('*')];
        for (const el of els) if (el.shadowRoot) els.push(...all(el.shadowRoot));
        return els;
      };
      const els = all(document);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const target = els.find((e) => e.tagName === 'INPUT' && e.name === ${JSON.stringify(name)});
      const btn = els.find((b) => b.tagName === 'BUTTON' && /log in|continue|next|verify/i.test(b.textContent || ''));
      if (!target || !btn) return { target: !!target, btn: !!btn };
      target.focus();
      setter.call(target, ${JSON.stringify(value)});
      target.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      await new Promise((r2) => setTimeout(r2, 300));
      btn.click();
      return { ok: true };
    })()`);

  let stageCount = 0;
  let backAtApp = false;
  for (let pass = 0; pass < 8; pass++) {
    await sleep(3000);
    const st = await evalJs(`(() => {
      const all = (root) => {
        const els = [...root.querySelectorAll('*')];
        for (const el of els) if (el.shadowRoot) els.push(...all(el.shadowRoot));
        return els;
      };
      const els = all(document);
      const inputs = els.filter((e) => e.tagName === 'INPUT').map((i) => i.name || i.type);
      return { url: location.href, inputs };
    })()`);
    if (st.evalError) throw new Error(st.evalError);
    if (st.url.startsWith(APP) && !st.url.includes("/auth/")) {
      backAtApp = true;
      break;
    }
    if (st.inputs.includes("uidField")) {
      await fillAndSubmit("uidField", USER);
      stageCount++;
    } else if (st.inputs.includes("password")) {
      await fillAndSubmit("password", PASS);
      stageCount++;
    } else {
      console.log(`[auth] unknown stage at ${st.url.slice(0, 80)}`);
      break;
    }
  }

  // The session cookie lives in the browser — read it via CDP.
  const cdpCookies = await send("Network.getAllCookies");
  const session = (cdpCookies.cookies || []).find((c) => c.name === "plutus_session");
  console.log(`[auth] back at app: ${backAtApp}`);
  console.log(`[auth] plutus_session cookie: ${session ? "SET ✓" : "MISSING ✗"}`);

  let meUser = null;
  if (session) {
    const me = await evalJs(`(async () => {
      const r = await fetch(${JSON.stringify(APP + "/auth/me")}, { credentials: "include" });
      return await r.json();
    })()`);
    meUser = me.user || null;
    console.log(`[auth] /auth/me user: ${meUser ? `${meUser.name} | isAdmin: ${meUser.isAdmin}` : "null"}`);
  }

  if (!session || !meUser) {
    console.error("[auth] ❌ SSO login check FAILED");
    process.exitCode = 1;
  } else {
    console.log("[auth] ✅ SSO login check passed");
  }
} finally {
  proc.kill();
  fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
}