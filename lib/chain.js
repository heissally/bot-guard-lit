// Reads from Base Sepolia (balances, explorer links). Read-only: nothing here can sign or send.

const { ethers } = require("ethers");
const C = require("./config");

const provider = new ethers.providers.StaticJsonRpcProvider(C.RPC_URL, C.CHAIN_ID);
const usdc = new ethers.Contract(C.USDC, ["function balanceOf(address) view returns (uint256)"], provider);

// The wallet's test ETH and test USDC, as BigNumbers.
async function getBalances(address = C.BOT_WALLET) {
  const [eth, usdcBalance] = await Promise.all([provider.getBalance(address), usdc.balanceOf(address)]);
  return { eth, usdc: usdcBalance };
}

const formatEth = (wei) => ethers.utils.formatEther(wei);
const formatEthShort = (wei) => Number(ethers.utils.formatEther(wei)).toFixed(6); // easier to read on video
const formatUsdc = (units) => ethers.utils.formatUnits(units, 6); // USDC has 6 decimals
const txLink = (hash) => `${C.EXPLORER}/tx/${hash}`;
const addressLink = (address) => `${C.EXPLORER}/address/${address}`;

module.exports = { provider, getBalances, formatEth, formatEthShort, formatUsdc, txLink, addressLink };
