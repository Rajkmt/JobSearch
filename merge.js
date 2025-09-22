// merge.js
const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Parser } = require('@json2csv/plainjs');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');

const LINKEDIN_CSV = path.join(DATA, 'results.csv');
const OUT_CSV_CLEAN = path.join(DATA, 'combined_results.csv');
const OUT_CSV_ALL   = path.join(DATA, 'combined_results_all.csv');

const FIELDS = [
  "li_job_id","company","title","matched_role","location","is_remote",
  "date_posted","ago_time","salary","job_url",
  "contact_emails","contact_phones","skills","description"
];

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function findGoogleCsv() {
  const candidates = [
    path.join(DATA,'google_jobs.csv'),
    path.join(DATA,'google_results.csv'),
    path.join(DATA,'google.csv')
  ];

  const existing = candidates
    .filter(p => fs.existsSync(p) && fs.statSync(p).size > 0)
    .map(p => ({ p, t: fs.statSync(p).mtimeMs }))
    .sort((a,b) => b.t - a.t);

  if (existing.length) return existing[0].p;

  // fallback: newest non-empty google*.csv inside data/
  if (fs.existsSync(DATA)) {
    const all = fs.readdirSync(DATA)
      .filter(f => /^google.*\.csv$/i.test(f))
      .map(f => path.join(DATA, f))
      .filter(p => fs.statSync(p).size > 0)
      .map(p => ({ p, t: fs.statSync(p).mtimeMs }))
      .sort((a,b) => b.t - a.t);
    if (all.length) return all[0].p;
  }

  return null;
}

function readCsvIfExists(file) {
  if (!file || !fs.existsSync(file)) return [];
  let txt = fs.readFileSync(file, 'utf8');

  // Strip UTF‑8 BOM if present
  if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1);
  if (!txt.trim()) return [];

  try {
    return parse(txt, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      relax_column_count: true,
      relax_quotes: true,
      relax: true,
      trim: true
    });
  } catch {
    const normalized = txt.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return parse(normalized, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      relax_column_count: true,
      relax_quotes: true,
      relax: true,
      trim: true
    });
  }
}

function toTargetRow(row) {
  const get = (obj, keys, def='') => {
    for (const k of keys) {
      if (obj[k] != null) {
        const v = String(obj[k]).trim();
        if (v !== '') return v;
      }
    }
    return def;
  };

  return {
    li_job_id:   get(row, ['li_job_id','job_id','id']),
    company:     get(row, ['company','company_name','org','employer']),
    title:       get(row, ['title','job_title','position']),
    matched_role:get(row, ['matched_role','role','standard_title']),
    location:    get(row, ['location','job_location','city']),
    is_remote:   get(row, ['is_remote','remote','remote_friendly']),
    date_posted: get(row, ['date_posted','posted_at','date']),
    ago_time:    get(row, ['ago_time','posted_ago']),
    salary:      get(row, ['salary','compensation','pay']),
    job_url:     get(row, ['job_url','url','link','href']),
    contact_emails: get(row, ['contact_emails','emails']),
    contact_phones: get(row, ['contact_phones','phones']),
    skills:      get(row, ['skills','skills_hint']),
    description: get(row, ['description','desc','snippet','summary'])
  };
}

function canonicalUrl(u = '') {
  try {
    const url = new URL(u);
    url.hash = '';
    url.search = '';
    let s = url.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch { return (u || '').trim(); }
}

function dedupe(rows) {
  const out = [];
  const seenIds = new Set();
  const seenUrls = new Set();
  const seenCombo = new Set();

  for (const r of rows) {
    const id = (r.li_job_id || '').trim();
    const cu = canonicalUrl(r.job_url || '');
    const ct = `${(r.company||'').toLowerCase().trim()}|${(r.title||'').toLowerCase().trim()}`;

    if (id && seenIds.has(id)) continue;
    if (cu && seenUrls.has(cu)) continue;
    if (ct && seenCombo.has(ct)) continue;

    out.push(r);
    if (id) seenIds.add(id);
    if (cu) seenUrls.add(cu);
    if (ct) seenCombo.add(ct);
  }
  return out;
}

(function main(){
  ensureDir(DATA);

  const GOOGLE_CSV = findGoogleCsv();
  if (!GOOGLE_CSV) console.warn('⚠️  No Google CSV found in data/. Proceeding with LinkedIn only.');
  else console.log(`🔎 Using Google CSV: ${GOOGLE_CSV}`);

  const googleRowsRaw = readCsvIfExists(GOOGLE_CSV);
  const liRowsRaw     = readCsvIfExists(LINKEDIN_CSV);

  const googleRows = googleRowsRaw.map(toTargetRow);
  const liRows     = liRowsRaw.map(toTargetRow);

  // 1) raw merge (audit)
  const combined = [...googleRows, ...liRows];
  const parser = new Parser({ fields: FIELDS });
  fs.writeFileSync(OUT_CSV_ALL, parser.parse(combined), 'utf8');

  // 2) dedupe (clean)
  const deduped = dedupe(combined);
  fs.writeFileSync(OUT_CSV_CLEAN, parser.parse(deduped), 'utf8');

  console.log(`✅ Merged ${googleRows.length} (Google) + ${liRows.length} (LinkedIn) = ${combined.length} rows`);
  console.log(`✅ After dedupe: ${deduped.length} rows`);
  console.log(`📄 Wrote clean: ${OUT_CSV_CLEAN}`);
  console.log(`📄 Wrote audit: ${OUT_CSV_ALL}`);
})();
