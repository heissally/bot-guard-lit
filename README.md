# Bot Guard on Lit

> ⚠️ **Unaudited testnet demo. Not production software.** It runs on the Base Sepolia testnet only. Don't use it with real funds.

A crypto trading bot that **never holds its own private key**. The key lives inside [Lit Protocol](https://developer.litprotocol.com). Before every signature, a small Lit Action (the "trade guard") checks the trade against fixed rules. If any rule fails, nothing is signed.

So even if someone hacks the bot's server and steals its credentials, they can only do what the rules allow: small swaps that pay back into the bot's own wallet.

## The demo

**The bot makes a normal trade, and Lit allows it:**

```
→ Bot asks Lit to sign: swap 0.0005 ETH for ≈ 0.930531 test USDC, paid to the bot's own wallet
  Lit checked every rule, signed the trade and sent it.
  🔗 https://sepolia.basescan.org/tx/0x1c386840161d67470b741619cfe806ef9d63e5032b21c055257d79efe6113c3f
  Confirmed on Base Sepolia (block 52193846).
✅ ALLOWED
```

**A "hacker" steals the bot's key and tries to take the money. Lit refuses every attempt:**

```
→ Attack 1: withdraw all 0.002499 ETH to the attacker's wallet
❌ REFUSED: not an approved contract

→ Attack 2: swap 0.002499 ETH in one trade (the cap is 0.001)
❌ REFUSED: over the per-trade cap (max 0.001 ETH)

→ Attack 3: a normal-looking 0.0005 ETH swap, but paid to the attacker's wallet
❌ REFUSED: swap output must go to the bot's own wallet

→ Attack 4: rewrite the rules (no cap, pay anyone), then swap everything to the attacker
❌ REFUSED: Lit won't run changed rules (this key may only run the approved trade guard)

💰 Balance after the attacks: 0.002499 ETH, 0.930531 test USDC
🛡️  4 of 4 attacks refused.
✅ Balance unchanged: not a single wei moved.
```

## Why this matters

Most trading bots keep a full-access private key in a `.env` file on a server. Whoever gets into the bot, its server or its hosting platform can empty the wallet. Bot settings limit how the bot *trades*, not what the key can *do*.

Here, the limits live somewhere the bot can't change them: inside Lit.

## How it works

```
bot.js ──(usage key + trade request)──▶ Lit ──runs──▶ trade-guard.js
                                                        │ checks every rule
                                                        ▼
                                  all pass? sign with the wallet's key and send to Base Sepolia
                                  any fail? refuse with a reason (nothing is signed)
```

| Piece | What it is |
| --- | --- |
| **Bot wallet** | A Lit wallet (PKP). Its key is created and kept inside Lit and never exported. |
| **Trade guard** ([trade-guard.js](trade-guard.js)) | A Lit Action: JavaScript that Lit runs before every signature. The rules are written into the code. |
| **Usage key** | The bot's only credential (in `.env`). It can run the trade guard and nothing else: it can't add code, add wallets or change rules. |
| **Bot** ([bot.js](bot.js)) | Stands in for a real trading bot. Asks Lit to sign one small swap on Uniswap. |
| **Attacker** ([attacker.js](attacker.js)) | Uses the bot's stolen usage key to try four ways of taking the money. |

Lit identifies an action by a fingerprint (CID) of its exact code. Changing even one character gives a new fingerprint, which the usage key isn't allowed to run. That's why attack 4 fails.

## The rules

The trade guard signs only if **every** rule passes. Anything else, including a missing field or an error, means no signature ("fail closed").

| Rule | What it stops |
| --- | --- |
| The transaction must go to the approved DEX (Uniswap v3 on Base Sepolia) | Withdrawals, and calls to any other contract |
| It must call the approved swap function only | Approvals, transfers, batches or other DEX functions |
| Only ETH → test USDC, on the 0.3% pool | Trades on other tokens or thin pools |
| The swap output must go back to the bot's own wallet | A swap that pays the attacker |
| The ETH sent must equal the swap amount exactly | Extra ETH left in the DEX for anyone to take |
| At most 0.001 ETH per trade | Emptying the wallet in one go |
| The request must expire within 2 minutes | Old requests being replayed later |
| Network fees and gas are capped, and the swap is test-run before signing | Burning the wallet's ETH on fees, or sending a swap that would fail |

The guard never returns, prints or logs the private key. It loads the key in exactly one place, after every rule has passed. The tests check this.

## What this doesn't protect against (honest limits)

- **A stolen usage key can still do what the rules allow:** many small swaps into test USDC, which stays in the bot's wallet. There's no daily cap, because the guard keeps no record of past trades.
- **No price check:** the guard doesn't check slippage. The bot sets its own minimum, but the guard doesn't enforce one.
- **Replays within the expiry window:** a captured request can be sent again until it expires (2 minutes at most).
- **The Lit account key is the master key:** whoever has it can change everything. It never goes near the bot, and the setup script never saves it. Moving the account to Lit's ChainSecured mode with a multisig would remove that single point of control. That's a next step, not part of this demo.
- **It's unaudited.** Review [trade-guard.js](trade-guard.js) like any code that moves money.

## Run it yourself

You'll need:
- **Node.js 22 or newer**
- **A [Lit Chipotle](https://dashboard.chipotle.litprotocol.com/dapps/dashboard/) account** with a few dollars of credits. The minimum top-up is $5, and the whole demo uses well under $1.
- **A little Base Sepolia test ETH** in MetaMask (about 0.003). Try the [Coinbase faucet](https://portal.cdp.coinbase.com/onchain-tools/faucet).

### 1. Install

```bash
npm install
```

### 2. Create the bot wallet

In the Lit dashboard, go to **Wallets** and click **Add**. Copy the new address, then put it, in lowercase, in both:
- [trade-guard.js](trade-guard.js), the `BOT_WALLET` line
- [lib/config.js](lib/config.js), the `BOT_WALLET` line

Then check that everything agrees:

```bash
npm test
```

All tests should pass. They run offline, with no Lit, no internet and no real key.

### 3. Set up Lit (choose one)

**Option A: the setup script (recommended).**

```bash
npm run setup
```

It asks for your Lit account key without showing it, and never saves it. It then:
- creates a `bot-guard` group containing only the trade guard and the bot wallet,
- creates a usage key that can only run actions in that group,
- saves the key into `.env` without printing it,
- checks that the key works and can't add code.

**Option B: the Lit dashboard, by hand.**

1. Run `npm run cid` and copy the fingerprint it prints. Don't paste the code into the dashboard instead: a single changed space gives a different fingerprint.
2. **IPFS Actions → Add**: paste the CID, name it `trade-guard`, then click **Add**.
3. **Groups → Add**: name it `bot-guard`.
   - **PKP IDs permitted**: tick only the bot wallet.
   - **CID hashes permitted**: tick only `trade-guard`.
   - Never tick **All**, and don't click **All Options**.
4. **Usage API Keys → Add**: name it `bot-guard-bot`.
   - Leave **Can create groups**, **Can delete groups** and **Can create PKPs** unticked. They can't be changed later.
   - **Can execute in groups**: tick only `bot-guard`.
   - Leave the other three group lists empty.
   - Don't click **All Options**. Then click **Add**.
5. Copy the new key, then run `npm run save-key` and paste it (nothing shows as you paste).
6. Run `npm run verify` to check it works.

Either way, `npm run check-account` (free, read-only) then confirms that no other usage key in your account can use the bot wallet.

### 4. Fund the bot wallet

Send about 0.003 Base Sepolia test ETH from MetaMask to the bot wallet, then:

```bash
npm run balance
```

### 5. Run the demo

```bash
npm run bot
```

```bash
npm run attack
```

Add `-- --verbose` to either one to see the raw request and Lit's answer (never any key).

**Important:** after setup, don't edit `trade-guard.js`, not even a space. A changed guard has a new fingerprint, so Lit will refuse to run it until you add the new fingerprint to the group again.

## Commands

| Command | What it does | Cost |
| --- | --- | --- |
| `npm test` | Offline tests of every rule | Free |
| `npm run cid` | Prints the trade guard's fingerprint (CID) | Free |
| `npm run setup` | One-time Lit setup (group, usage key, checks) | About $0.05 |
| `npm run save-key` | Saves a dashboard-made usage key into `.env` | Free |
| `npm run verify` | Checks the usage key can run the guard | About $0.01 |
| `npm run check-account` | Read-only check of who can use the bot wallet | Free |
| `npm run balance` | Shows the bot wallet's balance | Free |
| `npm run bot` | The bot asks for one small swap | About $0.02 + 0.0005 test ETH |
| `npm run attack` | Four attacks with the stolen usage key | About $0.03, no gas |
| `npm run check-secrets` | Checks staged files for secrets before a git commit | Free |

## Project files

```
trade-guard.js      the rules (the Lit Action)
bot.js              the trading bot
attacker.js         the attacker
lib/                shared code: settings, Lit API, Base Sepolia, trade requests, output
scripts/            setup and helper scripts
test/               offline tests for the trade guard
```

## Credits

Based on Lit's article [How fintechs make sure no single employee can move funds](https://spark.litprotocol.com/no-single-employee-can-move-funds/), with the payment service swapped for a trading bot. Built on Lit's Chipotle network and Uniswap v3 on Base Sepolia.

## License

[MIT](LICENSE) © 2026 Salami Sally. Provided as is, without warranty. See the warning at the top.
