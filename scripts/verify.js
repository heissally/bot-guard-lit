// Checks that the bot's usage key (from .env) can run the trade guard on Lit.
// Sends an already-expired request, which the guard must refuse. Costs about $0.01.
// Run with: npm run verify

const { checkGuardRuns } = require("../lib/lit");
const { loadUsageKey } = require("../lib/env");

async function main() {
  const usageKey = loadUsageKey();
  console.log("Checking the usage key can run the trade guard (can take up to a minute)...");
  let result;
  try {
    result = await checkGuardRuns(usageKey);
  } catch (e) {
    if (e.status === 403) {
      throw new Error(
        "Lit says this key may not run the trade guard. Check that the group holds the guard's exact CID (npm run cid) and the bot wallet, and that the key can execute in that group."
      );
    }
    throw e;
  }
  if (result.ok) console.log('✅ The trade guard ran on Lit and refused a test request: "request expired"');
  else console.log(`⚠️  Unexpected answer from the trade guard: ${JSON.stringify(result.response)}`);
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
