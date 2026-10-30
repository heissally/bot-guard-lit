// Shows the bot wallet's balance on Base Sepolia. Free and read-only; needs no key.
// Run with: npm run balance

const { ethers } = require("ethers");
const C = require("../lib/config");
const { getBalances, formatEth, formatUsdc, addressLink } = require("../lib/chain");

const ENOUGH_FOR_ONE_TRADE = ethers.utils.parseEther("0.0006"); // a 0.0005 ETH trade plus gas

async function main() {
  const { eth, usdc } = await getBalances();
  console.log(`Bot wallet ${C.BOT_WALLET} on Base Sepolia`);
  console.log(`  ETH:       ${formatEth(eth)}`);
  console.log(`  test USDC: ${formatUsdc(usdc)}`);
  console.log(`  Explorer:  ${addressLink(C.BOT_WALLET)}`);
  if (eth.lt(ENOUGH_FOR_ONE_TRADE)) console.log("\n⚠️  Not enough test ETH for a trade yet (need at least 0.0006).");
  else console.log("\n✅ Enough test ETH for the demo.");
}

main().catch((e) => {
  console.error(`\n❌ Couldn't read the balance: ${e.message}`);
  process.exit(1);
});
