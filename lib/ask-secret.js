// Asks for a secret in the terminal without showing what you type or paste.
// The secret is only kept in memory while the script runs; it is never saved or printed.

function askSecret(prompt) {
  const stdin = process.stdin;
  if (!stdin.isTTY) throw new Error("Run this script directly in Terminal so it can ask for the key.");

  return new Promise((resolve) => {
    process.stdout.write(prompt);
    let value = "";

    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return finish();
        if (ch === "\u0003") {
          // Ctrl+C: stop the script
          cleanup();
          process.stdout.write("\nStopped.\n");
          process.exit(1);
        }
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    };
    const finish = () => {
      cleanup();
      process.stdout.write("\n");
      // Remove invisible "paste" markers some terminals add, and stray spaces.
      resolve(value.replace(/\x1b\[20[01]~/g, "").trim());
    };

    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.on("data", onData);
    stdin.resume();
  });
}

module.exports = { askSecret };
