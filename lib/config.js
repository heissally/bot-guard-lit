// Public settings shared by the bot, the attacker and the tests.
// Nothing here is secret. The trade guard (trade-guard.js) keeps its own copy of
// these values, because Lit runs that file on its own; the tests check that both match.

module.exports = {
  CHAIN_ID: 84532, // Base Sepolia testnet
  RPC_URL: "https://sepolia.base.org", // official Base Sepolia server
  EXPLORER: "https://sepolia.basescan.org",
  LIT_API: "https://api.chipotle.litprotocol.com/core/v1",

  BOT_WALLET: "0x30509316a7637e80de82064836b549bda4b887c2", // the bot's Lit wallet (created in step 2)
  ROUTER: "0x94cc0aac535ccdb3c01d6787d6413c739ae12bc4", // Uniswap v3 SwapRouter02 on Base Sepolia
  QUOTER: "0xc5290058841028f1614f3a6f0f5816cad0df5e27", // Uniswap v3 QuoterV2: price quotes only, read-only
  WETH: "0x4200000000000000000000000000000000000006", // wrapped ETH
  USDC: "0x036cbd53842c5426634e7929541ec2318f3dcf7e", // Circle's test USDC on Base Sepolia
  POOL_FEE: 3000, // the 0.3% ETH/USDC pool
  MAX_TRADE_WEI: "1000000000000000", // per-trade cap: 0.001 ETH

  // The "hacker's" wallet in the attacker script. Nobody holds its key; it just has to be someone else's.
  ATTACKER_WALLET: "0xbad" + "0".repeat(34) + "bad",
};
