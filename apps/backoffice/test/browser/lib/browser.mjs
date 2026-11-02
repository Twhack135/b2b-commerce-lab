// A headless Chromium browser (Edge or Chrome) with its own temporary
// profile, controlled through the Chrome DevTools Protocol (CDP). No extra
// test dependency is needed: Node's built-in WebSocket and fetch suffice.

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startProcess, waitForHttp } from "./processes.mjs";

const CANDIDATES = {
  win32: [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ],
  darwin: [
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ],
  linux: ["/usr/bin/microsoft-edge", "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
};

/** BROWSER_PATH, or the first installed Edge/Chrome */
export function findBrowser(env = process.env) {
  if (env.BROWSER_PATH) {
    if (!existsSync(env.BROWSER_PATH)) throw new Error(`BROWSER_PATH ${env.BROWSER_PATH} does not exist.`);
    return env.BROWSER_PATH;
  }
  const found = (CANDIDATES[process.platform] ?? []).find((path) => existsSync(path));
  if (!found) throw new Error("No Edge or Chrome found. Set BROWSER_PATH to a Chromium-based browser.");
  return found;
}

/** Starts the browser; returns the owned process and a connected page */
export async function launchBrowser({ executable, port, profileDir, logFile, screenshotDir }) {
  const browser = startProcess(
    "browser",
    executable,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profileDir}`,
      "about:blank",
    ],
    { cwd: profileDir, env: process.env, logFile },
  );
  await waitForHttp(`http://127.0.0.1:${port}/json/version`, browser, 30_000);
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find((t) => t.type === "page");
  if (!target) throw new Error("The browser has no page.");
  const page = new Page(target.webSocketDebuggerUrl, screenshotDir);
  await page.open();
  return { browser, page };
}

/** Helper functions installed into every loaded page (window.$...) */
const PAGE_HELPERS = `
  window.$vis = (el) => !!el && !!el.offsetParent;
  window.$btn = (t) => [...document.querySelectorAll('button')].filter($vis).find(b => b.textContent.trim().startsWith(t));
  window.$set = (id, v) => {
    const el = document.getElementById(id);
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  };
  window.$setEl = (el, v) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  window.$text = (sel) => document.querySelector(sel)?.innerText.replace(/\\s+/g, ' ').trim() ?? null;
  window.$overflow = () => document.documentElement.scrollWidth > window.innerWidth;
`;

/**
 * One browser tab. Records the bodies of selected POST requests, uncaught
 * page errors, and can answer or change requests through one-time rules
 * (CDP Fetch domain), e.g. to lose the answer of a request.
 */
export class Page {
  constructor(wsUrl, screenshotDir) {
    this.wsUrl = wsUrl;
    this.screenshotDir = screenshotDir;
    this.nextId = 1;
    this.pending = new Map();
    this.pageErrors = [];
    this.recorded = [];
    this.recordPattern = null;
    this.rules = [];
    this.extraHelpers = "";
    // An expression describing the relevant page state; reported on timeouts
    this.diagnostics = "";
    // Path of every request (by CDP request ID) and the number of finished
    // requests per path
    this.requestPaths = new Map();
    this.finished = new Map();
    // Method and full URL of every request of the page, in order
    this.requests = [];
  }

  async open() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => this.#onMessage(JSON.parse(event.data)));
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Network.enable");
    await this.viewport(1440, 900);
  }

  close() {
    this.ws?.close();
  }

  #onMessage(msg) {
    if (msg.id && this.pending.has(msg.id)) {
      this.pending.get(msg.id)(msg);
      this.pending.delete(msg.id);
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const details = msg.params.exceptionDetails;
      this.pageErrors.push(details.exception?.description ?? details.text);
    }
    if (msg.method === "Network.requestWillBeSent") {
      const { method, url, postData } = msg.params.request;
      const path = URL.canParse(url) ? new URL(url).pathname : url;
      this.requestPaths.set(msg.params.requestId, path);
      this.requests.push({ method, url });
      if (this.recordPattern && method === "POST" && this.recordPattern.test(path)) {
        this.recorded.push(JSON.parse(postData));
      }
    }
    if (msg.method === "Network.loadingFinished" || msg.method === "Network.loadingFailed") {
      const path = this.requestPaths.get(msg.params.requestId);
      if (path) this.finished.set(path, (this.finished.get(path) ?? 0) + 1);
    }
    if (msg.method === "Fetch.requestPaused") {
      const params = msg.params;
      const stage = params.responseStatusCode === undefined ? "request" : "response";
      const index = this.rules.findIndex((r) => r.stage === stage && params.request.method === r.method);
      if (index >= 0) {
        const [rule] = this.rules.splice(index, 1);
        rule.act(params);
      } else {
        this.send("Fetch.continueRequest", { requestId: params.requestId }).catch(() => {});
      }
    }
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(`${expression.slice(0, 200)}\n${result.exceptionDetails.exception?.description}`);
    }
    return result.result.value;
  }

  /** Number of finished (or failed) requests to `path` so far */
  finishedCount(path) {
    return this.finished.get(path) ?? 0;
  }

  /**
   * Waits until the condition holds: a page expression, or an async
   * function (for conditions that also involve the network). Throws with
   * the URL, the page state (`diagnostics`) and a screenshot otherwise.
   */
  async waitFor(condition, label, timeoutMs = 10_000) {
    if (await this.#poll(condition, timeoutMs)) return;
    await this.screenshot("timeout.png").catch(() => {});
    const state = await this.evaluate(`JSON.stringify({
      // Without the fragment: it can hold secrets such as an activation token
      url: location.origin + location.pathname + location.search,
      alerts: [...document.querySelectorAll('[role=alert],[role=status]')].map(e => e.textContent.trim()).filter(Boolean),
      ${this.diagnostics ? `page: ${this.diagnostics},` : ""}
    })`).catch((error) => `page state unavailable: ${error.message}`);
    throw new Error(`Timeout waiting for: ${label}\n  state: ${state}`);
  }

  /**
   * Selects `value` in the <select> with this ID, the way a user would: only
   * once the option is offered and enabled. Then waits until the selection
   * has persisted and `settled` (what the selection causes) holds, so the
   * test never continues with a selection the application has reset.
   */
  async select(id, value, settled, label = `${id} = ${value}`) {
    const el = `document.getElementById(${JSON.stringify(id)})`;
    const expected = JSON.stringify(value);
    await this.waitFor(
      `!!${el} && !${el}.disabled && [...${el}.options].some(o => o.value === ${expected} && !o.disabled)`,
      `${label}: option offered and enabled (actual: value, disabled and options in state)`,
    );
    await this.evaluate(`$set(${JSON.stringify(id)}, ${expected})`);
    await this.waitFor(`${el}.value === ${expected} && (${settled})`, `${label}: selection persisted and applied`);
  }

  /** Same as waitFor, but answers true or false instead of throwing */
  becomes(condition, timeoutMs) {
    return this.#poll(condition, timeoutMs);
  }

  /** True as soon as the condition holds, false after the timeout */
  async #poll(condition, timeoutMs) {
    const holds =
      typeof condition === "function"
        ? () => condition().catch(() => false)
        : () => this.evaluate(`(() => { try { return !!(${condition}); } catch { return false; } })()`).catch(() => false);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await holds()) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return false;
  }

  /** Installs the page helpers (again after every full page load) */
  async installHelpers() {
    await this.evaluate(PAGE_HELPERS + this.extraHelpers);
  }

  /** Full page load of `url`; waits for `readyExpression` */
  async goto(url, readyExpression) {
    await this.send("Page.navigate", { url });
    // Labels without the fragment of the URL (see waitFor)
    const shown = url.split("#")[0];
    await this.waitFor("document.readyState === 'complete'", `load ${shown}`);
    await this.installHelpers();
    await this.waitFor(readyExpression, `page ${shown}`);
  }

  async viewport(width, height, mobile = false) {
    await this.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  }

  async screenshot(name) {
    if (!this.screenshotDir) return;
    const { data } = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(this.screenshotDir, name), Buffer.from(data, "base64"));
  }

  /** Records the JSON bodies of POST requests whose path matches */
  record(pathPattern) {
    this.recordPattern = pathPattern;
    this.recorded = [];
  }

  /** Intercepts requests matching the URL patterns (rules decide what happens) */
  async intercept(urlPatterns) {
    await this.send("Fetch.enable", {
      patterns: urlPatterns.flatMap((urlPattern) => [
        { urlPattern, requestStage: "Request" },
        { urlPattern, requestStage: "Response" },
      ]),
    });
  }

  /** A one-time rule for the next intercepted request at `stage` */
  once(stage, act, method = "POST") {
    this.rules.push({ stage, method, act });
  }
}

/** A JSON answer for Fetch.fulfillRequest */
export function jsonAnswer(status, body) {
  return {
    responseCode: status,
    responseHeaders: [{ name: "Content-Type", value: "application/json" }],
    body: Buffer.from(JSON.stringify(body), "utf8").toString("base64"),
  };
}
