// One-time Lit setup for the Bot Guard. Uses your Lit ACCOUNT key, which it asks
// for without showing it, and never saves or prints. Costs about $0.05 in Lit credits.
//
// What it does:
// 1. Gets the trade guard's fingerprint (CID).
// 2. Creates a group "bot-guard" and puts exactly two things in it: the trade guard and the bot wallet.
// 3. Creates the bot's usage key, which can ONLY run actions in that group. Nothing else.
// 4. Saves the usage key straight into .env (it is never printed).
// 5. Checks that the key works, and that it can't add new code.
//
// Run with: npm run setup

const C = require("../lib/config");
const { guardCode, litRequest, getCid, toGroupNumber, listAll, checkGuardRuns } = require("../lib/lit");
const { askSecret } = require("../lib/ask-secret");
const { hasUsageKey, saveUsageKey } = require("../lib/env");

async function main() {
  console.log("Bot Guard setup on Lit\n");
  if (hasUsageKey()) {
    throw new Error(".env already has a LIT_USAGE_KEY, so setup has already run. Running it again would create a second group and key. Ask Claude before going further.");
  }

  // 1. Fingerprint of the trade guard (free)
  const cid = await getCid(guardCode());
  console.log(`Trade guard fingerprint (CID): ${cid}`);

  const accountKey = await askSecret("\nPaste your Lit ACCOUNT key (nothing will show as you paste), then press Enter: ");
  if (!accountKey) throw new Error("No key entered.");

  // Safety check: this account must own the bot wallet (free)
  const wallets = await listAll("list_wallets", accountKey);
  if (!wallets.some((w) => String(w.wallet_address).toLowerCase() === C.BOT_WALLET)) {
    throw new Error(`The bot wallet ${C.BOT_WALLET} is not in this Lit account. Nothing was created.`);
  }
  console.log(`✅ Bot wallet ${C.BOT_WALLET} belongs to this account`);

  // 2. Group with exactly the trade guard and the bot wallet ($0.01 per call)
  const group = await litRequest("add_group", {
    method: "POST",
    key: accountKey,
    body: {
      group_name: "bot-guard",
      group_description: "Bot Guard demo: the trade guard action and the bot wallet, nothing else.",
      pkp_ids_permitted: [],
      cid_hashes_permitted: [],
    },
  });
  const groupId = toGroupNumber(group.group_id); // Lit returns it as text, e.g. "7"; requests need the number 7
  if (!group.success || groupId === null || groupId <= 0) {
    throw new Error(`Lit didn't return a group ID: ${JSON.stringify(group)}`);
  }
  console.log(`✅ Created group ${groupId} "bot-guard"`);

  await litRequest("add_action_to_group", {
    method: "POST",
    key: accountKey,
    body: { group_id: groupId, action_ipfs_cid: cid },
  });
  console.log("✅ Added the trade guard to the group");

  await litRequest("add_pkp_to_group", {
    method: "POST",
    key: accountKey,
    body: { group_id: groupId, pkp_id: C.BOT_WALLET },
  });
  console.log("✅ Added the bot wallet to the group");

  // 3. The bot's usage key: run actions in this group, nothing else
  const created = await litRequest("add_usage_api_key", {
    method: "POST",
    key: accountKey,
    body: {
      name: "bot-guard-bot",
      description: `Bot Guard demo bot. Can only run actions in group ${groupId}.`,
      can_create_groups: false,
      can_delete_groups: false,
      can_create_pkps: false,
      manage_ipfs_ids_in_groups: [],
      add_pkp_to_groups: [],
      remove_pkp_from_groups: [],
      execute_in_groups: [groupId],
    },
  });
  if (!created.success || !created.usage_api_key) throw new Error("Lit didn't return a usage key.");

  // 4. Save it straight away, without printing it
  saveUsageKey(created.usage_api_key);
  console.log("✅ Created the bot's usage key and saved it in .env (not shown here)");
  console.log(`   It can: run actions in group ${groupId} (only the trade guard is in it)`);
  console.log("   It can't: add or change actions, add or remove wallets, create or delete groups, create wallets");

  // 5a. Check the bot wallet is in the group (free)
  const members = await listAll("list_wallets_in_group", accountKey, { group_id: groupId });
  const inGroup = members.some((m) => String(m.wallet_address).toLowerCase() === C.BOT_WALLET);
  console.log(inGroup ? "✅ Lit lists the bot wallet in the group" : "⚠️  Lit doesn't list the bot wallet in the group yet");

  // 5b. Run the guard once with an expired request; it should refuse it.
  console.log("\nChecking the usage key can run the trade guard (can take up to a minute)...");
  const result = await checkGuardRuns(created.usage_api_key);
  if (result.ok) {
    console.log('✅ The trade guard ran on Lit and refused a test request: "request expired"');
  } else {
    console.log(`⚠️  Unexpected answer from the trade guard: ${JSON.stringify(result.response)}`);
  }

  // 5c. The usage key must NOT be able to add actions. We try to add the guard
  // again (harmless if it worked); Lit should refuse.
  try {
    await litRequest("add_action_to_group", {
      method: "POST",
      key: created.usage_api_key,
      body: { group_id: groupId, action_ipfs_cid: cid },
    });
    console.log("⚠️  The usage key was able to add an action. Stop and tell Claude.");
  } catch (e) {
    console.log(`✅ The usage key can't add actions (Lit answered ${e.status || "with an error"})`);
  }

  console.log(`\nSetup done. Group ID: ${groupId}. You can close Terminal or run: npm run check-account`);
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
