// Prints the trade guard's fingerprint (IPFS CID), to paste into the Lit dashboard.
// Free, needs no key. It reads trade-guard.js exactly as saved, so the fingerprint
// matches the code the bot sends (copy-pasting the code by hand can change it).
// Run with: npm run cid

const { guardCode, getCid } = require("../lib/lit");

getCid(guardCode())
  .then((cid) => {
    console.log("Trade guard fingerprint (CID):");
    console.log(cid);
  })
  .catch((e) => {
    console.error(`\n❌ ${e.message}`);
    process.exit(1);
  });
