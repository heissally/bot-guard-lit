// attacker.js: pretend a hacker broke into the bot's server and stole its Lit usage key.
//
// The attacker uses the SAME usage key the bot uses (read from .env) and tries
// four ways to take the money. The trade guard on Lit refuses every one, so
// nothing is signed and the wallet balance doesn't change. (Every attack sends
// funds to a made-up attacker address that nobody controls.)
//
// Run with: npm run attack   (add --verbose to see the raw requests and Lit's answers)

const { ethers } = require("ethers");
const C = require("./lib/config");
const R = require("./lib/requests");
const { loadUsageKey } = require("./lib/env");
const { guardCode } = require("./lib/lit");
const { formatEthShort } = require("./lib/chain");
const { showBalance, askGuard } = require("./lib/demo");

const TWICE_THE_CAP = ethers.BigNumber.from(C.MAX_TRADE_WEI).mul(2);

// Changes one exact piece of the guard's code, or stops if it can't find it.
function rewrite(code, from, to) {
  if (!code.includes(from)) throw new Error(`couldn't find this line to edit in trade-guard.js: ${from}`);
  return code.replace(from, to);
}

async function main() {
  const stolenKey = loadUsageKey(); // the bot's own key, "stolen" from its server
  console.log("🦹 Attacker: I broke into the bot's server and stole its Lit usage key.");
  console.log(`   Target wallet: ${C.BOT_WALLET}`);
  const before = await showBalance("Balance before the attacks");
  const everything = before.eth;
  const results = [];

  // Attack 1: send all the ETH straight to the attacker.
  results.push(
    await askGuard(
      stolenKey,
      `Attack 1: withdraw all ${formatEthShort(everything)} ETH to the attacker's wallet`,
      R.transferRequest({ to: C.ATTACKER_WALLET, amountWei: everything })
    )
  );

  // Attack 2: empty the wallet in one huge trade.
  const huge = everything.gt(TWICE_THE_CAP) ? everything : TWICE_THE_CAP;
  results.push(
    await askGuard(
      stolenKey,
      `Attack 2: swap ${formatEthShort(huge)} ETH in one trade (the cap is 0.001)`,
      R.swapRequest({ amountWei: huge })
    )
  );

  // Attack 3: a small, normal-looking swap, but the USDC goes to the attacker.
  results.push(
    await askGuard(
      stolenKey,
      "Attack 3: a normal-looking 0.0005 ETH swap, but paid to the attacker's wallet",
      R.swapRequest({ amountWei: ethers.utils.parseEther("0.0005"), recipient: C.ATTACKER_WALLET })
    )
  );

  // Attack 4: rewrite the rules (no cap, pay anyone), then swap everything to the attacker.
  let edited = rewrite(guardCode(), "const MAX_TRADE_WEI = 1000000000000000n;", "const MAX_TRADE_WEI = 1000000000000000000000n;");
  edited = rewrite(
    edited,
    `if (p.recipient.toLowerCase() !== BOT_WALLET) return no("swap output must go to the bot's own wallet");`,
    "// (recipient check deleted by the attacker)"
  );
  results.push(
    await askGuard(
      stolenKey,
      "Attack 4: rewrite the rules (no cap, pay anyone), then swap everything to the attacker",
      R.swapRequest({ amountWei: everything, recipient: C.ATTACKER_WALLET }),
      { code: edited }
    )
  );

  console.log("");
  const after = await showBalance("Balance after the attacks");
  const refusedCount = results.filter((r) => r.reason).length;
  console.log(`🛡️  ${refusedCount} of ${results.length} attacks refused.`);
  if (after.eth.eq(before.eth) && after.usdc.eq(before.usdc)) {
    console.log("✅ Balance unchanged: not a single wei moved.");
  } else {
    console.log("⚠️  The balance changed. Paste this output to Claude.");
  }
}

main().catch((e) => {
  console.error(`\n❌ ERROR: ${e.message}`);
  process.exit(1);
});
