// PixelShop browser verification (no dependencies — drives chrome-headless-shell
// directly over the Chrome DevTools Protocol using Node's built-in fetch/WebSocket).
//
// Modes:
//   node scripts/browser-check.mjs play                  verify demo clips play end-to-end
//   node scripts/browser-check.mjs submit <product-url>  submit a product, watch the pipeline
//
// Env:
//   CHROME_PATH      override the chrome-headless-shell binary
//   PIXELSHOP_URL    override the app URL (default http://127.0.0.1:3000/)
//
// Exits non-zero when the check fails, so it can be used in CI.

import { spawn } from "node:child_process";

const CHROME =
  process.env.CHROME_PATH ||
  "/root/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell";
const PORT = 9222;
const URL = process.env.PIXELSHOP_URL || "http://127.0.0.1:3000/";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function spawnChrome() {
  const proc = spawn(
    CHROME,
    [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--autoplay-policy=no-user-gesture-required",
      "--mute-audio",
      `--remote-debugging-port=${PORT}`,
      "--user-data-dir=/tmp/chrome-pixelshop-check",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  proc.on("exit", (c) => console.log(`[chrome] exited with code ${c}`));
  return proc;
}

async function waitForDevtools() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return await r.json();
    } catch {}
    await sleep(250);
  }
  throw new Error("Chrome DevTools endpoint did not come up");
}

async function connect() {
  const page = await (
    await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })
  ).json();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error("ws error"));
  });

  let msgId = 0;
  const pending = new Map();
  const consoleErrors = [];
  const failedRequests = [];
  const pageEvents = [];

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
      return;
    }
    if (!msg.method) return;
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      const args = (msg.params.args || [])
        .map((a) => (a.value !== undefined ? String(a.value) : a.description || a.type))
        .join(" ");
      consoleErrors.push(`console.error: ${args}`);
    }
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
      consoleErrors.push(`log.error: ${msg.params.entry.text}`);
    }
    if (msg.method === "Network.loadingFailed") {
      const p = msg.params;
      failedRequests.push(
        `${p.errorText} (${p.type}) canceled=${!!p.canceled} blocked=${p.blockedReason || "-"}`,
      );
    }
    if (["Page.loadEventFired", "Page.frameNavigated"].includes(msg.method)) {
      pageEvents.push(msg.method);
    }
  };

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const evalJs = async (expression) => {
    const res = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) return { evalError: res.exceptionDetails.text };
    return res.result?.value;
  };

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Log.enable");

  return { ws, send, evalJs, consoleErrors, failedRequests, pageEvents };
}

// React-controlled inputs need the native value setter + an input event.
const FILL_AND_SUBMIT = (url) => `(() => {
  const input = document.querySelector('input[placeholder="store.com/your-product"]');
  if (!input) return { ok: false, reason: "submit input not found" };
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, ${JSON.stringify(url)});
  input.dispatchEvent(new Event("input", { bubbles: true }));
  const form = input.closest("form");
  const btn = form ? form.querySelector('button[type="submit"]') : null;
  if (!btn) return { ok: false, reason: "submit button not found" };
  btn.click();
  return { ok: true };
})()`;

const SAMPLE_PLAYBACK_JS = `(() => {
  const main = document.querySelector('video:not(.hidden)');
  const h2 = document.querySelector('h2');
  const sub = document.querySelector('p[class*="max-w-2xl"]');
  const liveBadge = [...document.querySelectorAll('span')].some((s) => s.textContent.includes('LIVE'));
  return {
    hasVideo: !!main,
    videoSrc: main ? main.currentSrc || main.src : null,
    paused: main ? main.paused : null,
    readyState: main ? main.readyState : null,
    currentTime: main ? +main.currentTime.toFixed(2) : null,
    videoError: main && main.error ? main.error.code + ":" + main.error.message : null,
    title: h2 ? h2.textContent.trim() : null,
    dialogue: sub ? sub.textContent.trim().slice(0, 80) : null,
    liveBadge,
    standby: !!document.body.innerText.match(/PLEASE STAND BY/),
  };
})()`;

const SAMPLE_SUBMIT_JS = `(() => {
  const box = document.querySelector('div[class*="border-pink/30"]');
  const pending = [...document.querySelectorAll('div')].filter((d) =>
    d.textContent.includes('in production')
  ).map((d) => d.textContent.trim().replace(/\\s+/g, ' ').slice(0, 100));
  return {
    submitBox: box ? box.innerText.replace(/\\s+/g, ' ').trim().slice(0, 300) : null,
    pending,
    hasVideo: !!document.querySelector('video:not(.hidden)'),
    title: (document.querySelector('h2') || {}).textContent || null,
  };
})()`;

async function runPlayback(c, durationSec = 48) {
  console.log(`[play] verifying demo playback on ${URL} for ${durationSec}s`);
  await c.send("Page.navigate", { url: URL });

  const samples = [];
  const start = Date.now();
  while (Date.now() - start < durationSec * 1000) {
    await sleep(1000);
    try {
      samples.push(await c.evalJs(SAMPLE_PLAYBACK_JS));
    } catch (err) {
      samples.push({ evalError: String(err) });
    }
  }

  const withVideo = samples.filter((s) => s && s.hasVideo);
  const played = withVideo.filter((s) => s.readyState >= 3 && !s.paused);
  const maxTime = Math.max(0, ...withVideo.map((s) => s.currentTime || 0));
  const titles = [...new Set(withVideo.map((s) => s.title).filter(Boolean))];
  const dialogues = [...new Set(withVideo.map((s) => s.dialogue).filter(Boolean))];
  const errors = [...new Set(withVideo.map((s) => s.videoError).filter(Boolean))];

  console.log("\n===== PLAYBACK RESULTS =====");
  console.log("samples captured:", samples.length);
  console.log("titles seen over time:", titles.join(" | ") || "(none)");
  console.log("dialogue lines seen:", dialogues.length);
  console.log("max video currentTime:", maxTime, "s");
  console.log("samples with readyState>=3 & playing:", played.length);
  console.log("video errors:", errors.length ? errors.join("; ") : "none");
  console.log("standby seen at any point:", samples.some((s) => s && s.standby));
  console.log("live badge seen:", samples.some((s) => s && s.liveBadge));

  console.log("\n-- transitions (title change) --");
  let lastTitle = null;
  samples.forEach((s, i) => {
    if (s && s.title && s.title !== lastTitle) {
      console.log(`t=${i}s -> ${s.title} (readyState=${s.readyState}, paused=${s.paused}, t=${s.currentTime})`);
      lastTitle = s.title;
    }
  });

  const fail = [];
  if (samples.length === 0) fail.push("no samples captured");
  if (played.length === 0) fail.push("video never reached readyState>=3 while playing");
  if (maxTime < 3) fail.push("video did not advance (currentTime < 3s)");
  if (titles.length < 1) fail.push("no product titles rendered");
  if (errors.length) fail.push("video errors: " + errors.join("; "));

  return fail;
}

async function runSubmit(c, productUrl, durationSec = 120) {
  console.log(`[submit] submitting ${productUrl} on ${URL} (up to ${durationSec}s)`);
  // Desktop viewport so the sidebar SubmitBox is visible
  await c.send("Emulation.setDeviceMetricsOverride", {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await c.send("Page.navigate", { url: URL });

  // Wait for the submit box, then fill + submit
  let filled = null;
  for (let i = 0; i < 30 && !filled?.ok; i++) {
    await sleep(1000);
    filled = await c.evalJs(FILL_AND_SUBMIT(productUrl));
  }
  if (!filled?.ok) {
    return [`could not fill submit form: ${JSON.stringify(filled)}`];
  }
  console.log("[submit] form submitted, waiting for pipeline…");

  const samples = [];
  const start = Date.now();
  while (Date.now() - start < durationSec * 1000) {
    await sleep(2000);
    try {
      samples.push(await c.evalJs(SAMPLE_SUBMIT_JS));
    } catch (err) {
      samples.push({ evalError: String(err) });
    }
  }

  console.log("\n===== SUBMIT RESULTS =====");
  console.log("samples captured:", samples.length);
  console.log("\n-- submit box + pending timeline --");
  let lastBox = null;
  samples.forEach((s, i) => {
    const t = Math.round((Date.now() - start) / 1000);
    const box = s?.submitBox || "";
    if (box !== lastBox) {
      console.log(`t=${t}s: ${box.slice(0, 200)}`);
      lastBox = box;
    }
    if (s?.pending?.length) {
      console.log(`t=${t}s pending: ${s.pending.join(" | ")}`);
    }
  });

  console.log("\n-- playback during pipeline --");
  const withVideo = samples.filter((s) => s && s.hasVideo);
  const titles = [...new Set(withVideo.map((s) => s.title).filter(Boolean))];
  console.log("titles seen:", titles.join(" | ") || "(none)");
  console.log("video present in samples:", withVideo.length, "of", samples.length);

  const allText = samples.map((s) => s?.submitBox || "").join("\n");
  const fail = [];
  if (!/preparing the studio|ON IT|YOU'RE ON AIR|Couldn't air/.test(allText)) {
    fail.push("submit box never showed working/terminal state");
  }
  if (!/YOU'RE ON AIR|Couldn't air/.test(allText)) {
    fail.push("pipeline never reached a terminal state (ready or failed)");
  }
  if (withVideo.length === 0) fail.push("demo player was not running during pipeline");

  return fail;
}

async function main() {
  const mode = process.argv[2] || "play";
  const arg = process.argv[3];

  if (mode === "submit" && !arg) {
    console.error("usage: node scripts/browser-check.mjs submit <product-url>");
    process.exit(2);
  }

  const proc = spawnChrome();
  try {
    await waitForDevtools();
    const c = await connect();

    const fail = mode === "submit" ? await runSubmit(c, arg) : await runPlayback(c);

    console.log("\nconsole errors:", c.consoleErrors.length ? c.consoleErrors : "none");
    console.log(
      "failed requests:",
      c.failedRequests.length ? [...new Set(c.failedRequests)].join(" | ") : "none",
    );

    const issues = [
      ...fail,
      ...(c.consoleErrors.length ? ["console errors present"] : []),
      ...(c.failedRequests.length ? ["failed network requests"] : []),
    ];

    if (issues.length) {
      console.log(`\n❌ CHECK FAILED:`);
      for (const i of issues) console.log("  -", i);
      process.exitCode = 1;
    } else {
      console.log("\n✅ CHECK PASSED");
    }

    c.ws.close();
  } finally {
    proc.kill("SIGKILL");
  }
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});