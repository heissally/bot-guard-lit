// bot.js: the trading bot.
//
// It holds NO private key. Its only credential is a Lit usage key (in .env)
// that can run the trade guard and nothing else. It asks Lit to sign one small
// swap: 0.0005 test ETH for test USDC, paid back to the bot's own wallet.
// Lit runs the trade guard, which checks the rules before anything is signed.
//
// Run with: npm run bot   (add --verbose to see the raw request and Lit's answer)

const { ethers } = require("ethers");
const C = require("./lib/config");
const R = require("./lib/requests");
const { loadUsageKey } = require("./lib/env");
const { provider, formatUsdc } = require("./lib/chain");
const { showBalance, askGuard } = require("./lib/demo");

const TRADE_ETH = "0.0005";
const SLIPPAGE_PERCENT = 5; // the bot accepts at most 5% less USDC than quoted

// Uniswap's price quoter (read-only), so the bot knows roughly what it should get back.
const quoter = new ethers.Contract(
  C.QUOTER,
  [
    "function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
  ],
  provider
);

async function main() {
  const usageKey = loadUsageKey();
  console.log("🤖 Trading bot: holds no private key. Lit checks every trade.");
  console.log(`   Wallet: ${C.BOT_WALLET}`);
  await showBalance("Balance");

  const amountWei = ethers.utils.parseEther(TRADE_ETH);
  const quote = await quoter.callStatic
    .quoteExactInputSingle({ tokenIn: C.WETH, tokenOut: C.USDC, amountIn: amountWei, fee: C.POOL_FEE, sqrtPriceLimitX96: 0 })
    .catch(() => {
      throw new Error("couldn't get a price quote from Uniswap on Base Sepolia. Wait a minute and try again.");
    });
  const minimumOut = quote.amountOut.mul(100 - SLIPPAGE_PERCENT).div(100);

  const request = R.swapRequest({ amountWei, amountOutMinimum: minimumOut });
  await askGuard(
    usageKey,
    `Bot asks Lit to sign: swap ${TRADE_ETH} ETH for ≈ ${formatUsdc(quote.amountOut)} test USDC, paid to the bot's own wallet`,
    request
  );

  await showBalance("Balance now");
}

main().catch((e) => {
  console.error(`\n❌ ERROR: ${e.message}`);
  process.exit(1);
});
