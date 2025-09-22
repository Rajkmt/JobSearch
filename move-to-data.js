// move-to-data.js
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function mvIfExists(src, dest) {
  if (!fs.existsSync(src)) return false;
  const destDir = path.dirname(dest);
  ensureDir(destDir);
  // If same file already exists, overwrite for simplicity
  fs.copyFileSync(src, dest);
  // remove original if it was in root
  if (path.dirname(src) === ROOT) fs.unlinkSync(src);
  console.log(`📦 Moved ${path.basename(src)} -> ${path.relative(ROOT, dest)}`);
  return true;
}

(function main() {
  ensureDir(DATA);

  // Known Google file names
  const googleCandidates = ['google_jobs.csv', 'google_results.csv', 'google.csv'];
  for (const name of googleCandidates) {
    mvIfExists(path.join(ROOT, name), path.join(DATA, name));
  }

  // LinkedIn file name
  mvIfExists(path.join(ROOT, 'results.csv'), path.join(DATA, 'results.csv'));

  // Combined outputs (if they exist in root from prior runs)
  mvIfExists(path.join(ROOT, 'combined_results.csv'), path.join(DATA, 'combined_results.csv'));
  mvIfExists(path.join(ROOT, 'combined_results_all.csv'), path.join(DATA, 'combined_results_all.csv'));

  console.log('✅ organize: data folder is clean.');
})();
