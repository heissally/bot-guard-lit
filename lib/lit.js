// Talks to Lit's Chipotle API with plain fetch (no SDK), like Lit's own examples.
// Never prints or returns the API keys it is given.

const fs = require("node:fs");
const path = require("node:path");
const C = require("./config");
const { swapRequest } = require("./requests");

const GUARD_PATH = path.join(__dirname, "..", "trade-guard.js");

// The exact text of the trade guard. Lit fingerprints this text, so it is sent as-is.
function guardCode() {
  return fs.readFileSync(GUARD_PATH, "utf8");
}

// One call to the Lit API. Throws an error with `.status` if Lit says no.
async function litRequest(apiPath, { method = "GET", key, body, query } = {}) {
  const url = new URL(`${C.LIT_API}/${apiPath}`);
  for (const [name, value] of Object.entries(query || {})) url.searchParams.set(name, String(value));

  const headers = { "X-Privacy-Mode": "true" }; // asks Lit not to log what we send
  if (key) headers["X-Api-Key"] = key;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(120_000),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  if (!res.ok) {
    // Name the endpoint and its query (never the key), so an error says exactly which request failed.
    const detail = typeof data === "string" ? data : JSON.stringify(data);
    const err = new Error(`Lit answered ${res.status} to ${method} ${apiPath}${url.search}: ${detail.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// The fingerprint (IPFS CID) Lit uses to identify a piece of action code. Free, no key needed.
async function getCid(code) {
  return litRequest("get_lit_action_ipfs_id", { method: "POST", body: code });
}

// Lit lists group IDs as text, such as "3", and its schema says IDs may also be
// written in hex, such as "0x3". Requests need a plain whole number (a "u64").
// Returns that number, or null if the text isn't a usable group ID.
function toGroupNumber(id) {
  const text = String(id).trim();
  if (!text) return null;
  try {
    const n = BigInt(text);
    return n >= 0n && n <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(n) : null;
  } catch {
    return null;
  }
}

// Reads every page of a Lit list (wallets, groups, keys). Free.
// The docs don't say whether pages start at 0 or 1, so this handles both.
async function listAll(apiPath, key, query = {}) {
  const items = new Map();
  for (let page = 0; page < 20; page++) {
    let batch;
    try {
      batch = await litRequest(apiPath, { key, query: { ...query, page_number: page, page_size: 100 } });
    } catch (e) {
      if (page === 0 && (e.status === 400 || e.status === 422)) continue;
      throw e;
    }
    if (!Array.isArray(batch)) throw new Error(`Unexpected answer from Lit's ${apiPath}`);
    let added = 0;
    for (const item of batch) {
      const id = JSON.stringify(item);
      if (!items.has(id)) {
        items.set(id, item);
        added++;
      }
    }
    if (page > 0 && added === 0) break;
  }
  return [...items.values()];
}

// Runs the trade guard on Lit with one trade request, using the bot's usage key.
// `code` defaults to the real guard; the attacker script passes an edited copy.
async function runGuard(usageKey, request, code = guardCode()) {
  const data = await litRequest("lit_action", {
    method: "POST",
    key: usageKey,
    body: { code, js_params: { request } },
  });
  let response = data.response;
  if (typeof response === "string") {
    try {
      response = JSON.parse(response);
    } catch {}
  }
  return { response, logs: data.logs, hasError: data.has_error };
}

// Checks a usage key can run the trade guard: sends an already-expired request,
// which the guard must refuse with "request expired" (costs about $0.01).
// New permissions can take a minute to switch on, so this retries while Lit
// answers 403 "not authorized" (refused requests aren't charged).
async function checkGuardRuns(usageKey) {
  const expired = swapRequest({ amountWei: "500000000000000", expires: Date.now() - 1000 });
  for (let attempt = 1; ; attempt++) {
    try {
      const { response } = await runGuard(usageKey, expired);
      const ok = !!response && response.allowed === false && response.reason === "request expired";
      return { ok, response };
    } catch (e) {
      if (e.status !== 403 || attempt === 12) throw e;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

module.exports = { guardCode, litRequest, getCid, toGroupNumber, listAll, runGuard, checkGuardRuns };
