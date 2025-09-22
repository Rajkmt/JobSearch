// run-both.js
const { spawn } = require("child_process");

function run(cmd, args, label) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", shell: true });
    p.on("close", (code) => {
      if (code === 0) {
        console.log(`\n✅ ${label} finished.`);
        resolve();
      } else {
        reject(new Error(`${label} exited with code ${code}`));
      }
    });
  });
}

(async () => {
  try {
    console.log("🚀 Starting Google CSE …");
    await run("node", ["google/google.js"], "Google CSE");

    console.log("\n🚀 Starting LinkedIn scraper …");
    await run("node", ["index.js"], "LinkedIn");

    console.log("\n🎉 All done. Check your output files (e.g., google_jobs.csv, results.csv).");
  } catch (e) {
    console.error("❌ Failed:", e.message);
    process.exit(1);
  }
})();
