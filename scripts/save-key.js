// Saves a usage key you created in the Lit dashboard into .env, without showing it.
// Run with: npm run save-key

const { askSecret } = require("../lib/ask-secret");
const { hasUsageKey, saveUsageKey } = require("../lib/env");

async function main() {
  if (hasUsageKey()) {
    throw new Error(".env already has a LIT_USAGE_KEY. Nothing was changed. Ask Claude before replacing it.");
  }
  const key = await askSecret("Paste the bot's usage key (nothing will show as you paste), then press Enter: ");
  if (!key || /\s/.test(key) || key.length < 20) throw new Error("That doesn't look like a usage key. Nothing was saved.");
  saveUsageKey(key);
  console.log("✅ Saved in .env (not shown). Next: npm run verify");
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
