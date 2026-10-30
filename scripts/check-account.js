// Read-only safety check of your Lit account. Free: it only lists things.
//
// It answers: "Can anything in this account, other than the trade guard, use the bot wallet?"
// To use a wallet, a usage key needs to run code in a group that contains that wallet
// (or allows ALL wallets). So the check looks at:
// - which groups can use the bot wallet, and which actions are in them,
// - which usage keys can run code in those groups, or could set that up themselves.
//
// Your account key isn't listed: it is the master key for everything in the account.
// It can't run actions itself, but it can create keys and groups, so it never goes near the bot.
//
// Lit's key list shows each key's permissions only, never the key itself, so nothing secret is printed.
// Run with: npm run check-account

const C = require("../lib/config");
const { listAll, toGroupNumber } = require("../lib/lit");
const { askSecret } = require("../lib/ask-secret");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"; // Lit's "all wallets" wildcard
const BOT_KEY_NAME = "bot-guard-bot"; // the usage key setup.js creates
const BOT_GROUP_NAME = "bot-guard"; // the group setup.js creates

const groupList = (ids) => ids.map(Number);
const listText = (ids) => (ids.includes(0) ? "ALL groups" : `group ${ids.join(", ")}`);
const canRunIn = (execute, groupId) => execute.includes(0) || execute.includes(groupId);

// Describes a usage key's permissions in plain words.
function describeKey(k) {
  const execute = groupList(k.can_execute_in_groups);
  const manage = groupList(k.can_manage_ipfs_ids_in_groups);
  const addPkp = groupList(k.can_add_pkp_to_groups);
  const removePkp = groupList(k.can_remove_pkp_from_groups);
  const powers = [];
  if (execute.length) powers.push(execute.includes(0) ? "run ANY code" : `run actions in ${listText(execute)}`);
  if (manage.length) powers.push(`add/remove actions in ${listText(manage)}`);
  if (addPkp.length) powers.push(`add wallets to ${listText(addPkp)}`);
  if (removePkp.length) powers.push(`remove wallets from ${listText(removePkp)}`);
  if (k.can_create_groups) powers.push("create groups");
  if (k.can_delete_groups) powers.push("delete groups");
  if (k.can_create_pkps) powers.push("create wallets");
  // It could set up its own access: put the bot wallet into a group, or its own code into one.
  const couldSetUpAccess = execute.length > 0 && (k.can_create_groups || addPkp.length > 0 || manage.includes(0));
  return { execute, powers, couldSetUpAccess };
}

async function main() {
  console.log("Lit account safety check (read-only, free)\n");
  const accountKey = await askSecret("Paste your Lit ACCOUNT key (nothing will show as you paste), then press Enter: ");
  if (!accountKey) throw new Error("No key entered.");

  // 1. Does this account own the bot wallet?
  const wallets = await listAll("list_wallets", accountKey);
  const ownsBot = wallets.some((w) => String(w.wallet_address).toLowerCase() === C.BOT_WALLET);
  console.log(`\nBot wallet ${C.BOT_WALLET}`);
  console.log(ownsBot ? "✅ belongs to this Lit account" : "❌ NOT found in this Lit account. Stop and tell Claude.");

  const keys = (await listAll("list_api_keys", accountKey)).map((k) => ({ ...k, ...describeKey(k) }));
  let warnings = 0;

  // 2. Groups: which ones can use the bot wallet, what's in them, and who can run them?
  console.log("\nGroups");
  const groups = await listAll("list_groups", accountKey);
  const botGroups = []; // groups that can use the bot wallet
  for (const g of groups) {
    const groupId = toGroupNumber(g.id);
    if (groupId === null) {
      console.log(`  group ID "${g.id}" "${g.name}": couldn't check it (unexpected ID format) ⚠️`);
      warnings++;
      continue;
    }
    const members = await listAll("list_wallets_in_group", accountKey, { group_id: groupId });
    const addresses = members.map((m) => String(m.wallet_address).toLowerCase());
    const actions = await listAll("list_actions", accountKey, { group_id: groupId });
    const actionNames = actions.map((a) => a.name || "(no name)").join(", ") || "none";

    const hasBot = addresses.includes(C.BOT_WALLET);
    const allWallets = addresses.includes(ZERO_ADDRESS);
    const walletText = allWallets ? "ALL wallets" : hasBot ? `${addresses.length} wallet(s), including the BOT wallet` : `${addresses.length} wallet(s)`;
    console.log(`  group ${groupId} "${g.name}": ${walletText}; actions: ${actionNames}`);

    if (hasBot || allWallets) {
      botGroups.push(groupId);
      const runners = keys.filter((k) => canRunIn(k.execute, groupId)).map((k) => k.name || "(no name)");
      const expected = g.name === BOT_GROUP_NAME && runners.every((name) => name === BOT_KEY_NAME);
      if (!runners.length) {
        console.log("      ✅ can use the bot wallet, but no usage key can run actions in it");
      } else if (expected) {
        console.log(`      ✅ the bot's group, run only by "${BOT_KEY_NAME}"`);
      } else {
        console.log(`      ⚠️  can use the bot wallet, and these keys can run actions in it: ${runners.join(", ")}`);
        warnings++;
      }
    }
  }
  if (!groups.length) console.log("  (none)");

  // 3. Usage keys: who could reach the bot wallet?
  console.log("\nUsage keys (permissions only; the keys themselves are never shown)");
  for (const k of keys) {
    const runsBotGroup = botGroups.some((id) => canRunIn(k.execute, id));
    const isBotKey = k.name === BOT_KEY_NAME && k.powers.length === 1 && k.execute.length === 1;
    const risky = (runsBotGroup && !isBotKey) || k.couldSetUpAccess;
    if (risky) warnings++;
    console.log(`  ${risky ? "⚠️ " : "✅"} "${k.name || "(no name)"}": ${k.powers.length ? k.powers.join("; ") : "no permissions"}`);
  }
  if (!keys.length) console.log("  (none)");

  console.log(
    warnings
      ? `\n⚠️  ${warnings} warning(s). Paste this output to Claude before going further.`
      : "\n✅ No usage key other than the bot's can use the bot wallet."
  );
}

main().catch((e) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
