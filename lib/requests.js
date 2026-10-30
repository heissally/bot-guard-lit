// Builds the trade requests the bot (and the attacker) send to the trade guard.
// A request is a proposed transaction: { to, value, data, expires }.
// The guard decides whether to sign it; these helpers just fill in the fields.

const { ethers } = require("ethers");
const C = require("./config");

// Uniswap's "swap an exact amount in" function on SwapRouter02.
const swapInterface = new ethers.utils.Interface([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
]);

// Requests expire one minute from now unless told otherwise.
function expiresIn(ms = 60_000) {
  return Date.now() + ms;
}

// A swap of `amountWei` test ETH into test USDC, paid out to `recipient`.
function swapRequest({ amountWei, recipient = C.BOT_WALLET, fee = C.POOL_FEE, amountOutMinimum = 0, expires = expiresIn() }) {
  const data = swapInterface.encodeFunctionData("exactInputSingle", [
    {
      tokenIn: C.WETH,
      tokenOut: C.USDC,
      fee,
      recipient,
      amountIn: amountWei.toString(),
      amountOutMinimum: amountOutMinimum.toString(),
      sqrtPriceLimitX96: 0,
    },
  ]);
  return { to: C.ROUTER, value: amountWei.toString(), data, expires };
}

// A plain ETH transfer to `to`: what a withdrawal looks like.
function transferRequest({ to, amountWei, expires = expiresIn() }) {
  return { to, value: amountWei.toString(), data: "0x", expires };
}

// Any other contract call.
function callRequest({ to, data, value = "0", expires = expiresIn() }) {
  return { to, value: value.toString(), data, expires };
}

module.exports = { swapInterface, expiresIn, swapRequest, transferRequest, callRequest };
