// Shared terminal output for the bot and attacker scripts:
// one request in, one clear verdict line out ("✅ ALLOWED" or "❌ REFUSED: <reason>").
// Add --verbose to a run to also see the raw request and Lit's answer (never any key).

const { runGuard } = require("./lit");
const { provider, getBalances, formatEthShort, formatUsdc, txLink } = require("./chain");

const verbose = process.argv.includes("--verbose");

async function showBalance(label) {
  const { eth, usdc } = await getBalances();
  console.log(`💰 ${label}: ${formatEthShort(eth)} ETH, ${formatUsdc(usdc)} test USDC`);
  return { eth, usdc };
}

function refused(reason) {
  console.log(`❌ REFUSED: ${reason}`);
  return { allowed: false, reason };
}

function failed(message) {
  console.log(`❌ ERROR: ${message}`);
  return { allowed: false, error: true };
}

// Sends one request to the trade guard on Lit and prints what happened.
// `code` lets the attacker send an edited copy of the guard.
async function askGuard(usageKey, description, request, { code } = {}) {
  console.log(`\n→ ${description}`);
  if (verbose) console.log(`  request: ${JSON.stringify(request)}`);

  let result;
  try {
    result = await runGuard(usageKey, request, code);
  } catch (e) {
    if (verbose) console.log(`  ${e.message}`);
    if (e.status === 403) return refused("Lit won't run changed rules (this key may only run the approved trade guard)");
    if (e.status === 402) return failed("your Lit account is out of credits");
    return failed(`couldn't get an answer from Lit (${e.status ? "status " + e.status : e.message}). Try again, or add --verbose`);
  }
  if (verbose) console.log(`  Lit answered: ${JSON.stringify(result)}`);

  const answer = result.response;
  if (result.hasError || !answer || typeof answer.allowed !== "boolean") {
    return failed("unexpected answer from Lit (run again with --verbose)");
  }
  if (!answer.allowed) return refused(answer.reason);

  console.log("  Lit checked every rule, signed the trade and sent it.");
  console.log(`  🔗 ${txLink(answer.txHash)}`);
  const receipt = await provider.waitForTransaction(answer.txHash, 1, 90_000).catch(() => null);
  if (!receipt) console.log("  Still waiting for Base Sepolia to confirm it; check the link above.");
  else if (receipt.status === 1) console.log(`  Confirmed on Base Sepolia (block ${receipt.blockNumber}).`);
  else console.log("  ⚠️  Lit allowed it, but the swap failed on-chain. Check the link above.");
  console.log("✅ ALLOWED");
  return { allowed: true, txHash: answer.txHash };
}

module.exports = { verbose, showBalance, askGuard };
