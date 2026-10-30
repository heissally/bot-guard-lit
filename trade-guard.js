// trade-guard.js: the Bot Guard (a Lit Action)
//
// Lit runs this file before every signature. The bot sends a trade request
// ({ to, value, data, expires }); this code checks it against the fixed rules
// below. Only if EVERY rule passes does it load the bot wallet's key, sign the
// trade and send it to Base Sepolia. Anything else (a broken rule, a missing
// field, an error) means nothing is signed. This is called "failing closed".
//
// Lit identifies this file by a fingerprint (CID) of its exact text. Changing
// even one character gives a new fingerprint, which the bot's usage key is not
// allowed to run. So the rules cannot be changed with a stolen usage key.
//
// SAFETY: this code never returns, prints or logs the private key. It doesn't
// log anything at all, and the key is loaded in exactly one place (signAndSend).
//
// Lit provides `ethers` (version 5), `fetch` and `Lit` to this file.

// ---- Fixed settings (public values, not secrets) ----

const BOT_WALLET = "0x30509316a7637e80de82064836b549bda4b887c2"; // the bot's Lit wallet
const CHAIN_ID = 84532; // Base Sepolia testnet
const RPC_URL = "https://sepolia.base.org"; // official Base Sepolia server, fixed here so no request can swap it
const ROUTER = "0x94cc0aac535ccdb3c01d6787d6413c739ae12bc4"; // Uniswap v3 SwapRouter02: the only approved contract
const WETH = "0x4200000000000000000000000000000000000006"; // wrapped ETH
const USDC = "0x036cbd53842c5426634e7929541ec2318f3dcf7e"; // Circle's test USDC
const POOL_FEE = 3000; // the 0.3% ETH/USDC pool: the only approved pool
const MAX_TRADE_WEI = 1000000000000000n; // per-trade cap: 0.001 ETH
const MAX_EXPIRY_MS = 2 * 60 * 1000; // a request may be valid for 2 minutes at most

// Gas limits, so a request can't burn the wallet's ETH on network fees.
const MAX_GAS_LIMIT = 300000n; // a normal swap uses about 150,000
const MAX_FEE_PER_GAS = 1000000000n; // 1 gwei; Base Sepolia is usually below 0.01 gwei
const PRIORITY_FEE = 1000000n; // 0.001 gwei tip

// The one approved function: Uniswap's exactInputSingle (selector 0x04e45aaf).
const SWAP_SELECTOR = "0x04e45aaf";
const SWAP = new ethers.utils.Interface([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
]);

// ---- Entry point: Lit calls main() with the request the bot sent ----

async function main(params) {
  try {
    const check = checkRequest(params && params.request);
    if (!check.ok) return refuse(check.reason);
    return await signAndSend(check.tx);
  } catch (e) {
    // Fail closed. Only messages from the Base Sepolia server are passed on;
    // they can't contain the key, because the server never sees it.
    if (e && e.fromNetwork) return refuse("Base Sepolia rejected the request: " + e.message);
    return refuse("something went wrong, so nothing was signed");
  }
}

function refuse(reason) {
  return { allowed: false, reason };
}

// ---- The rules ----
// Each check returns a plain-English reason if it fails. None of them needs the key.

function checkRequest(req) {
  const no = (reason) => ({ ok: false, reason });

  // Rule: fail closed. Every field must be present and well-formed.
  if (!req || typeof req !== "object") return no("request is missing");
  const { to, value, data, expires } = req;
  if (typeof to !== "string" || !ethers.utils.isAddress(to)) return no("request has no valid destination address");
  if (typeof value !== "string" || !/^[0-9]{1,30}$/.test(value)) return no("request has no valid ETH amount");
  if (typeof data !== "string" || !/^0x([0-9a-fA-F]{2})*$/.test(data)) return no("request has no valid transaction data");
  if (typeof expires !== "number" || !Number.isFinite(expires)) return no("request has no expiry time");

  // Rule: the request must carry a short expiry that has not passed.
  const now = Date.now();
  if (expires <= now) return no("request expired");
  if (expires > now + MAX_EXPIRY_MS) return no("expiry is too far in the future (max 2 minutes)");

  // Rule: the transaction must go to the approved DEX contract.
  // This also blocks withdrawals: a plain ETH transfer goes to some other address.
  if (to.toLowerCase() !== ROUTER) return no("not an approved contract");

  // Rule: it must call the approved swap function only (no approvals, transfers,
  // batches or other DEX functions).
  if (data.slice(0, 10).toLowerCase() !== SWAP_SELECTOR) return no("not an approved swap function");
  let p;
  try {
    p = SWAP.decodeFunctionData("exactInputSingle", data).params;
  } catch (e) {
    return no("swap details could not be read");
  }
  // Re-encode the decoded swap and compare, so no hidden extra bytes can ride along.
  if (SWAP.encodeFunctionData("exactInputSingle", [p]).toLowerCase() !== data.toLowerCase()) {
    return no("swap details contain unexpected extra data");
  }

  // Rule: only ETH -> test USDC, on the approved 0.3% pool.
  if (p.tokenIn.toLowerCase() !== WETH || p.tokenOut.toLowerCase() !== USDC || Number(p.fee) !== POOL_FEE) {
    return no("only ETH → test USDC swaps on the approved pool are allowed");
  }

  // Rule: the swap output must go back to the bot's own wallet.
  if (p.recipient.toLowerCase() !== BOT_WALLET) return no("swap output must go to the bot's own wallet");

  // Rule: the ETH sent must equal the swap amount exactly. Extra ETH would be
  // left sitting in the Uniswap contract, where anyone could take it.
  const amountIn = BigInt(p.amountIn.toString());
  if (BigInt(value) !== amountIn) return no("ETH sent must equal the swap amount");

  // Rule: the amount must be at or below the per-trade cap.
  if (amountIn <= 0n) return no("swap amount must be more than zero");
  if (amountIn > MAX_TRADE_WEI) return no("over the per-trade cap (max 0.001 ETH)");

  return { ok: true, tx: { to: ROUTER, value: amountIn, data: data.toLowerCase() } };
}

// ---- Sign and send (only reached when every rule passed) ----

async function signAndSend(tx) {
  // Ask Base Sepolia for the current network fee and the wallet's next transaction number.
  const [gasPriceHex, nonceHex] = await Promise.all([
    rpc("eth_gasPrice", []),
    rpc("eth_getTransactionCount", [BOT_WALLET, "pending"]),
  ]);
  const maxFee = BigInt(gasPriceHex) * 2n + PRIORITY_FEE;
  if (maxFee > MAX_FEE_PER_GAS) return refuse("network fees are unusually high right now");

  // Dry run: ask the network whether this swap would succeed, before signing anything.
  let gasEstimate;
  try {
    gasEstimate = BigInt(await rpc("eth_estimateGas", [{ from: BOT_WALLET, to: tx.to, value: hex(tx.value), data: tx.data }]));
  } catch (e) {
    return refuse("the swap would fail on Base Sepolia" + (e && e.fromNetwork ? ": " + e.message : ""));
  }
  const gasLimit = (gasEstimate * 12n) / 10n; // 20% headroom
  if (gasLimit > MAX_GAS_LIMIT) return refuse("the swap needs more gas than allowed");

  // Every rule passed. Only now load the bot wallet's key. It stays inside this
  // function, inside Lit, and is never returned or logged.
  const wallet = new ethers.Wallet(await Lit.Actions.getPrivateKey({ pkpId: BOT_WALLET }));
  if (wallet.address.toLowerCase() !== BOT_WALLET) return refuse("Lit returned a different wallet than expected");

  const signedTx = await wallet.signTransaction({
    type: 2,
    chainId: CHAIN_ID,
    nonce: Number(nonceHex),
    to: tx.to,
    value: hex(tx.value),
    data: tx.data,
    gasLimit: hex(gasLimit),
    maxFeePerGas: hex(maxFee),
    maxPriorityFeePerGas: hex(PRIORITY_FEE),
  });
  const txHash = await rpc("eth_sendRawTransaction", [signedTx]);
  return { allowed: true, txHash };
}

// ---- Helpers ----

function hex(n) {
  return "0x" + n.toString(16);
}

// One call to the Base Sepolia server. Errors from the server are marked
// `fromNetwork` so main() can show them; they never contain the key.
async function rpc(method, params) {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    redirect: "error",
  });
  const body = await res.json();
  if (body.error || body.result === undefined) {
    const err = new Error(String((body.error && body.error.message) || "no answer").slice(0, 200));
    err.fromNetwork = true;
    throw err;
  }
  return body.result;
}
