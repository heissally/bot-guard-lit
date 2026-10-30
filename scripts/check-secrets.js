// Checks what you're about to upload to GitHub, before you commit. Read-only.
// - No secret or private files (.env, .env.admin, ...) and no node_modules are staged.
// - The bot's usage key (read from .env, never printed) is in none of the staged files.
// - No staged line looks like a stored secret, such as SOME_KEY=abc123.
// Run after "git add .":  npm run check-secrets

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

// Files that stay on your computer. PROJECT_BRIEF.md holds private notes about
// customer conversations; delete it from this list (and .gitignore) to publish it.
const PRIVATE_FILES = ["PROJECT_BRIEF.md"];

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

function isForbidden(file) {
  const name = path.basename(file);
  const secretFile = name.startsWith(".env") && name !== ".env.example";
  return secretFile || file.startsWith("node_modules/") || PRIVATE_FILES.includes(file);
}

function main() {
  let staged;
  try {
    staged = git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z").split("\0").filter(Boolean);
  } catch {
    throw new Error("This folder isn't a git repository yet. Run git init first.");
  }
  if (!staged.length) throw new Error("Nothing is staged yet. Run: git add .");

  console.log(`Files about to be uploaded (${staged.length}):`);
  for (const file of staged) console.log(`  ${file}`);
  console.log("");

  const problems = [];
  for (const file of staged) if (isForbidden(file)) problems.push(`${file} must not be uploaded`);
  if (!problems.length) console.log("✅ No .env files, private files or node_modules");

  // The bot's usage key, compared without ever printing it.
  const envPath = path.join(__dirname, "..", ".env");
  const match = fs.existsSync(envPath) && fs.readFileSync(envPath, "utf8").match(/^LIT_USAGE_KEY=(\S+)/m);
  const usageKey = match ? match[1] : null;

  const keyHits = [];
  const secretLines = [];
  for (const file of staged) {
    const content = git("show", `:${file}`);
    if (usageKey && content.includes(usageKey)) keyHits.push(file);
    content.split("\n").forEach((line, i) => {
      if (/^\s*(export\s+)?[A-Z0-9_]*(KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*\s*=\s*\S+/.test(line)) secretLines.push(`${file}:${i + 1}`);
    });
  }

  if (!usageKey) console.log("⚠️  No usage key found in .env to compare against (skipped that check)");
  else if (keyHits.length) keyHits.forEach((file) => problems.push(`${file} contains the bot's usage key`));
  else console.log("✅ The bot's usage key isn't in any of these files");

  if (secretLines.length) secretLines.forEach((where) => problems.push(`${where} looks like a stored secret`));
  else console.log("✅ No line looks like a stored secret");

  if (problems.length) {
    console.log("");
    problems.forEach((p) => console.log(`❌ ${p}`));
    console.log("\n❌ Don't commit. Paste this output to Claude.");
    process.exit(1);
  }
  console.log("\n✅ Safe to commit.");
}

try {
  main();
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}
