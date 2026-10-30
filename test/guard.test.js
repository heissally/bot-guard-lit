// Offline tests for the trade guard.
//
// No Lit, no internet and no real key: we run trade-guard.js on this computer
// with a throwaway test wallet and a pretend Base Sepolia server.
// Run with: npm test

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { ethers } = require("ethers");
const C = require("../lib/config");
const R = require("../lib/requests");

const GUARD_SOURCE = fs.readFileSync(path.join(__dirname, "..", "trade-guard.js"), "utf8");
const eth = (amount) => ethers.utils.parseEther(amount).toString();

// Loads the guard the way Lit would, but with:
// - a throwaway test wallet in place of the real bot wallet (so it can "sign"),
// - a fake Lit that hands out the test wallet's key and counts how often,
// - a fake Base Sepolia server. `rpc` can override its answers per method.
function loadGuard(rpc = {}) {
  const testWallet = ethers.Wallet.createRandom();
  const bot = testWallet.address.toLowerCase();
  const source = GUARD_SOURCE.replaceAll(C.BOT_WALLET, bot);
  assert.notEqual(source, GUARD_SOURCE, "the guard should contain the bot wallet address");

  const seen = { keyLoads: 0, rpcCalls: [], sentTx: null, logs: [] };
  const answers = {
    eth_gasPrice: "0x5b8d80", // 0.006 gwei
    eth_getTransactionCount: "0x3",
    eth_estimateGas: "0x23d6c", // about 146,000 gas
    eth_sendRawTransaction: (params) => {
      seen.sentTx = params[0];
      return ethers.utils.keccak256(params[0]);
    },
    ...rpc,
  };

  const fakeFetch = async (url, options) => {
    assert.equal(url, C.RPC_URL, "the guard should only talk to the official Base Sepolia server");
    const { method, params } = JSON.parse(options.body);
    seen.rpcCalls.push(method);
    const answer = answers[method];
    if (answer === "offline") throw new TypeError("fetch failed");
    if (answer && answer.error) return { json: async () => ({ jsonrpc: "2.0", id: 1, error: answer.error }) };
    const result = typeof answer === "function" ? answer(params) : answer;
    return { json: async () => ({ jsonrpc: "2.0", id: 1, result }) };
  };
  const fakeLit = {
    Actions: {
      getPrivateKey: async ({ pkpId }) => {
        seen.keyLoads++;
        assert.equal(pkpId, bot, "the guard should only ever ask for the bot wallet's key");
        return testWallet.privateKey;
      },
    },
  };
  const record = (...args) => seen.logs.push(args.join(" "));
  const fakeConsole = { log: record, info: record, warn: record, error: record, debug: record };

  const context = vm.createContext({ ethers, Lit: fakeLit, fetch: fakeFetch, console: fakeConsole });
  const main = vm.runInContext(source + "\n;main;", context);
  return { main, seen, bot, privateKey: testWallet.privateKey };
}

// Checks shared by every test: the key never shows up in the answer or in any log.
function assertNoKeyLeak(result, guard) {
  const key = guard.privateKey.slice(2).toLowerCase();
  assert.ok(!JSON.stringify(result).toLowerCase().includes(key), "the answer must never contain the key");
  assert.equal(guard.seen.logs.length, 0, "the guard must not log anything");
}

// A refused request: right reason, key never loaded, nothing sent.
async function assertRefused(guard, params, reasonPattern, { networkUsed = false } = {}) {
  const result = await guard.main(params);
  assert.equal(result.allowed, false, "this request should be refused");
  assert.match(result.reason, reasonPattern);
  assert.equal(guard.seen.keyLoads, 0, "the key must not be loaded for a refused request");
  assert.equal(guard.seen.sentTx, null, "nothing may be sent for a refused request");
  if (!networkUsed) assert.equal(guard.seen.rpcCalls.length, 0, "rule checks should refuse before touching the network");
  assertNoKeyLeak(result, guard);
  return result;
}

// ---- The trade the bot makes ----

test("normal trade: a 0.0005 ETH swap paid to the bot is allowed, signed and sent", async () => {
  const guard = loadGuard();
  const request = R.swapRequest({ amountWei: eth("0.0005"), recipient: guard.bot });
  const result = await guard.main({ request });

  assert.equal(result.allowed, true, `should be allowed, got: ${result.reason}`);
  assert.equal(guard.seen.keyLoads, 1);
  const sent = ethers.utils.parseTransaction(guard.seen.sentTx);
  assert.equal(result.txHash, sent.hash);
  assert.equal(sent.from.toLowerCase(), guard.bot);
  assert.equal(sent.to.toLowerCase(), C.ROUTER);
  assert.equal(sent.value.toString(), eth("0.0005"));
  assert.equal(sent.chainId, C.CHAIN_ID);
  assert.equal(sent.nonce, 3);
  assert.equal(sent.data, request.data.toLowerCase());
  assert.ok(sent.gasLimit.lte(300000), "gas must stay under the cap");
  assertNoKeyLeak(result, guard);
});

test("normal trade at exactly the cap (0.001 ETH) is allowed", async () => {
  const guard = loadGuard();
  const result = await guard.main({ request: R.swapRequest({ amountWei: eth("0.001"), recipient: guard.bot }) });
  assert.equal(result.allowed, true, `should be allowed, got: ${result.reason}`);
});

// ---- The attacks in the video ----

test("attack 1: withdraw everything to the attacker → not an approved contract", async () => {
  const guard = loadGuard();
  const request = R.transferRequest({ to: C.ATTACKER_WALLET, amountWei: eth("0.002") });
  await assertRefused(guard, { request }, /^not an approved contract$/);
});

test("attack 2: oversized trade (0.01 ETH) → over the per-trade cap", async () => {
  const guard = loadGuard();
  const request = R.swapRequest({ amountWei: eth("0.01"), recipient: guard.bot });
  await assertRefused(guard, { request }, /^over the per-trade cap/);
});

test("attack 3: small normal-looking swap paid to the attacker → swap output must go to the bot's own wallet", async () => {
  const guard = loadGuard();
  const request = R.swapRequest({ amountWei: eth("0.0005"), recipient: C.ATTACKER_WALLET });
  await assertRefused(guard, { request }, /^swap output must go to the bot's own wallet$/);
});

// ---- The other rules (not in the video) ----

test("expired request → request expired", async () => {
  const guard = loadGuard();
  const request = R.swapRequest({ amountWei: eth("0.0005"), recipient: guard.bot, expires: Date.now() - 1000 });
  await assertRefused(guard, { request }, /^request expired$/);
});

test("expiry more than 2 minutes away → refused", async () => {
  const guard = loadGuard();
  const request = R.swapRequest({ amountWei: eth("0.0005"), recipient: guard.bot, expires: R.expiresIn(10 * 60_000) });
  await assertRefused(guard, { request }, /^expiry is too far in the future/);
});

test("wrong function on the DEX (unwrap ETH to the attacker) → not an approved swap function", async () => {
  const guard = loadGuard();
  const router = new ethers.utils.Interface(["function unwrapWETH9(uint256 amountMinimum, address recipient)"]);
  const data = router.encodeFunctionData("unwrapWETH9", [0, C.ATTACKER_WALLET]);
  await assertRefused(guard, { request: R.callRequest({ to: C.ROUTER, data }) }, /^not an approved swap function$/);
});

test("wrong function on the DEX (a batch of calls) → not an approved swap function", async () => {
  const guard = loadGuard();
  const swap = R.swapRequest({ amountWei: eth("0.0005"), recipient: guard.bot });
  const router = new ethers.utils.Interface(["function multicall(uint256 deadline, bytes[] data)"]);
  const data = router.encodeFunctionData("multicall", [R.expiresIn(), [swap.data]]);
  await assertRefused(guard, { request: R.callRequest({ to: C.ROUTER, data, value: swap.value }) }, /^not an approved swap function$/);
});

test("unapproved contract (a USDC token transfer) → not an approved contract", async () => {
  const guard = loadGuard();
  const token = new ethers.utils.Interface(["function transfer(address to, uint256 amount)"]);
  const data = token.encodeFunctionData("transfer", [C.ATTACKER_WALLET, 1000000]);
  await assertRefused(guard, { request: R.callRequest({ to: C.USDC, data }) }, /^not an approved contract$/);
});

test("swap on a different pool (the 1% pool) → refused", async () => {
  const guard = loadGuard();
  const request = R.swapRequest({ amountWei: eth("0.0005"), recipient: guard.bot, fee: 10000 });
  await assertRefused(guard, { request }, /^only ETH → test USDC swaps on the approved pool are allowed$/);
});

test("ETH sent doesn't match the swap amount → refused", async () => {
  const guard = loadGuard();
  const request = R.swapRequest({ amountWei: eth("0.0005"), recipient: guard.bot });
  request.value = eth("0.0009");
  await assertRefused(guard, { request }, /^ETH sent must equal the swap amount$/);
});

test("zero-size swap → refused", async () => {
  const guard = loadGuard();
  const request = R.swapRequest({ amountWei: "0", recipient: guard.bot });
  await assertRefused(guard, { request }, /^swap amount must be more than zero$/);
});

// ---- Fail closed ----

test("fail closed: missing or garbled requests are refused", async () => {
  const good = () => R.swapRequest({ amountWei: eth("0.0005"), recipient: C.BOT_WALLET });
  const cases = [
    [undefined, /^request is missing$/],
    [{}, /^request is missing$/],
    [{ request: "please sign" }, /^request is missing$/],
    [{ request: { ...good(), to: undefined } }, /destination address/],
    [{ request: { ...good(), value: "lots" } }, /ETH amount/],
    [{ request: { ...good(), value: 500 } }, /ETH amount/],
    [{ request: { ...good(), data: "not hex" } }, /transaction data/],
    [{ request: { ...good(), expires: "soon" } }, /expiry time/],
    [{ request: { ...good(), data: good().data + "00" } }, /extra data|could not be read/],
    [{ request: { ...good(), data: good().data.slice(0, 50) } }, /could not be read/],
  ];
  for (const [params, reason] of cases) {
    await assertRefused(loadGuard(), params, reason);
  }
});

test("fail closed: if Base Sepolia can't be reached, nothing is signed", async () => {
  const guard = loadGuard({ eth_gasPrice: "offline" });
  const request = R.swapRequest({ amountWei: eth("0.0005"), recipient: guard.bot });
  await assertRefused(guard, { request }, /^something went wrong, so nothing was signed$/, { networkUsed: true });
});

test("a swap that would fail on-chain is refused before signing", async () => {
  const guard = loadGuard({ eth_estimateGas: { error: { code: -32000, message: "insufficient funds for transfer" } } });
  const request = R.swapRequest({ amountWei: eth("0.0005"), recipient: guard.bot });
  await assertRefused(guard, { request }, /^the swap would fail on Base Sepolia: insufficient funds/, { networkUsed: true });
});

test("very high network fees → refused before signing", async () => {
  const guard = loadGuard({ eth_gasPrice: "0x77359400" }); // 2 gwei
  const request = R.swapRequest({ amountWei: eth("0.0005"), recipient: guard.bot });
  await assertRefused(guard, { request }, /^network fees are unusually high/, { networkUsed: true });
});

test("a request asking for a different wallet is ignored: only the bot wallet is ever used", async () => {
  const guard = loadGuard();
  const request = R.swapRequest({ amountWei: eth("0.0005"), recipient: guard.bot });
  const result = await guard.main({ request, pkpId: C.ATTACKER_WALLET });
  assert.equal(result.allowed, true); // the fake Lit checks it was asked for the bot wallet only
});

// ---- Code checks ----

test("the guard has no logging, and loads the key in exactly one place", () => {
  assert.ok(!/console\./.test(GUARD_SOURCE), "no console.log or similar in the guard");
  assert.equal(GUARD_SOURCE.match(/getPrivateKey/g).length, 1);
});

test("the guard and the scripts use the same addresses, pool and cap", () => {
  const context = vm.createContext({ ethers });
  vm.runInContext(GUARD_SOURCE, context);
  const g = vm.runInContext(
    "({ BOT_WALLET, CHAIN_ID, RPC_URL, ROUTER, WETH, USDC, POOL_FEE, MAX_TRADE_WEI: MAX_TRADE_WEI.toString(), SWAP_SELECTOR })",
    context
  );
  for (const name of ["BOT_WALLET", "CHAIN_ID", "RPC_URL", "ROUTER", "WETH", "USDC", "POOL_FEE", "MAX_TRADE_WEI"]) {
    assert.equal(g[name], C[name], `${name} differs between trade-guard.js and lib/config.js`);
  }
  assert.equal(g.SWAP_SELECTOR, R.swapInterface.getSighash("exactInputSingle"));
});
