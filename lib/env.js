// Reads and writes the bot's usage key in the project's .env file. Never prints the key.

const fs = require("node:fs");
const path = require("node:path");

const ENV_PATH = path.join(__dirname, "..", ".env");

function hasUsageKey() {
  return fs.existsSync(ENV_PATH) && /^LIT_USAGE_KEY=\S+/m.test(fs.readFileSync(ENV_PATH, "utf8"));
}

// Saves LIT_USAGE_KEY into .env, readable only by you, keeping any other lines.
function saveUsageKey(usageKey) {
  const existing = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const lines = existing.split("\n").filter((line) => line.trim() && !line.startsWith("LIT_USAGE_KEY="));
  lines.push(`LIT_USAGE_KEY=${usageKey}`);
  fs.writeFileSync(ENV_PATH, lines.join("\n") + "\n", { mode: 0o600 });
}

function loadUsageKey() {
  if (!hasUsageKey()) throw new Error("No LIT_USAGE_KEY in .env yet. Run setup first (or npm run save-key).");
  process.loadEnvFile(ENV_PATH);
  return process.env.LIT_USAGE_KEY;
}

module.exports = { hasUsageKey, saveUsageKey, loadUsageKey };
