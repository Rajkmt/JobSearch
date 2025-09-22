// search.js
// Run: node search.js
// Output: results.csv (only NEW rows if INCREMENTAL_MODE=true)

const linkedIn = require("./index");
const axios = require("axios");
const cheerio = require("cheerio");
//const { Parser } = require("json2csv");
const { Parser } = require("@json2csv/plainjs");

const fs = require("fs/promises");

// ================== CONFIG ==================
const TITLES = [
  "Software Engineer","Software Developer",
  "Junior Software Engineer","Junior Software Developer",
  "Associate Software Engineer","Associate Software Developer",
  "Java Developer","Junior Java Developer",
  "Python Developer","Graduate Engineer Trainee","Software Trainee","Junior Developer",
  "Software Development Intern",
  "Backend Engineer","Frontend Engineer","Full Stack Engineer",
  "Software Testing","QA Engineer","Trainee Engineer"
];
const ROLE_PHRASES = TITLES.map(t => t.toLowerCase());
const NEGATIVE_TITLE_WORDS = ["senior","lead","staff","principal","architect","manager","sr."];

const SKILL_LIST = [
  "java","python","golang","c","c++","javascript","typescript",
  "spring","spring boot","hibernate",
  "html","css","react","angular","node","express",
  "sql","mysql","postgres","mongodb",
  "git","github","rest","rest api","microservices",
  "docker","kubernetes","aws","gcp","azure",
  "testing","selenium","jest","pytest"
];

// Single India-wide geo (24hr only)
const LOCATION = "India";

const EXPERIENCES = ["internship","entry level","associate"]; // 0–2 yrs coverage via LI tag
const DATE_WINDOW = "24hr";
const SORT = "recent";

const LIMIT_PER_QUERY = 5000;

const QUERY_CONCURRENCY = 3;
const DESC_CONCURRENCY = 6;
const DESC_BATCH_PAUSE_MS = 250;
const PAUSE_BETWEEN_QUERIES_MS = 250;

// collapse near-duplicates by same company+title (useful for multi-city clones)
const SOFT_DEDUPE_BY_COMPANY_TITLE = false;

// persistent dedupe across runs:
const PERSIST_SEEN = true;      // keep a memory of what you've already seen
const INCREMENTAL_MODE = false; // if true, results.csv will contain ONLY new jobs since last run
const SEEN_FILE = "seen_ids.json";
// ===========================================

const BASE_QUERY = {
  location: LOCATION,
  dateSincePosted: DATE_WINDOW,
  sortBy: SORT,
  limit: LIMIT_PER_QUERY,
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function uniqBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, x);
  }
  return [...m.values()];
}

function slug(s = "") {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function extractJobId(url) {
  if (!url) return null;
  const m = url.match(/(?:\/view\/[^/]*-(\d{6,}))/) || url.match(/currentJobId=(\d{6,})/);
  return m ? m[1] : null;
}

function canonicalUrl(url = "") {
  return url.split("?")[0];
}

function jobKeyByIdFirst(job) {
  return extractJobId(job.jobUrl) || canonicalUrl(job.jobUrl) || slug(`${job.company}|${job.position}`);
}

// ---------- contact extraction ----------
function extractEmails(text) {
  if (!text) return [];
  const re = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  return Array.from(new Set((text.match(re) || []).map(e => e.trim())));
}
function extractPhones(text) {
  if (!text) return [];
  const re = /(?:\+91[\s-]?)?(?:[6-9]\d{4}[-\s]?\d{5})\b/g;
  return Array.from(new Set(
    (text.match(re) || []).map(m =>
      m.replace(/[^\d+]/g, "").replace(/^(\d{10})$/, "+91$1")
    )
  ));
}

// ---------- skills extraction ----------
function extractSkills(text) {
  if (!text) return [];
  const s = text.toLowerCase();
  const hits = new Set();
  for (const skill of SKILL_LIST) {
    const esc = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${esc}\\b`, "i");
    if (re.test(s)) hits.add(skill);
  }
  return [...hits];
}

// ---------- description fetch ----------
async function fetchDescription(jobUrl, retries = 2) {
  const id = extractJobId(jobUrl);
  if (!id) return "";
  const url = `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { data } = await axios.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          "Accept-Language": "en-US,en;q=0.9",
        },
        timeout: 20000,
      });
      const $ = cheerio.load(data);
      const raw =
        $(".show-more-less-html__markup").text() ||
        $("#job-details").text() ||
        $("section.description").text() ||
        $("div.description").text() ||
        "";
      return raw.replace(/\s+/g, " ").trim();
    } catch {
      if (attempt === retries) return "";
      await sleep(600 + attempt * 400);
    }
  }
  return "";
}

async function fetchAllDescriptions(jobs) {
  console.log(`Fetching descriptions for ${jobs.length} jobs...`);
  for (let i = 0; i < jobs.length; i += DESC_CONCURRENCY) {
    const batch = jobs.slice(i, i + DESC_CONCURRENCY);
    const descs = await Promise.all(batch.map(j => fetchDescription(j.jobUrl).catch(() => "")));
    descs.forEach((d, idx) => (batch[idx].description = d));
    console.log(`  Descriptions ${Math.min(i + DESC_CONCURRENCY, jobs.length)}/${jobs.length}`);
    await sleep(DESC_BATCH_PAUSE_MS);
  }
  return jobs;
}

// ---------- filters ----------
function isIndiaOrRemoteQuick(job) {
  const loc = (job.location || "").toLowerCase();
  const title = (job.position || "").toLowerCase();
  return loc.includes("india") || loc.includes("remote") || title.includes("remote");
}
function isIndiaOrRemote(job, desc) {
  const loc = (job.location || "").toLowerCase();
  const title = (job.position || "").toLowerCase();
  const text = (desc || "").toLowerCase();
  const isIndia = loc.includes("india");
  const isRemote = loc.includes("remote") || title.includes("remote") || /remote|work\s*from\s*home|wfh/.test(text);
  return isIndia || isRemote;
}
function titleHasSeniorWords(title) {
  const t = (title || "").toLowerCase();
  return NEGATIVE_TITLE_WORDS.some(w => t.includes(w));
}
function titleLikelyMatch(title) {
  const t = (title || "").toLowerCase();
  if (!t) return false;
  if (titleHasSeniorWords(t)) return false;
  return ROLE_PHRASES.some(p => t.includes(p));
}
function roleMatches(title, description) {
  const t = (title || "").toLowerCase();
  const d = (description || "").toLowerCase();
  if (titleHasSeniorWords(t)) return false;
  return ROLE_PHRASES.some(p => t.includes(p) || d.includes(p));
}

// *** 0–2 yrs experience logic ***
function experienceAllowed(text) {
  const s = (text || "").toLowerCase();

  const positive = [
    /\bfresher(s)?\b/,
    /\bgraduate(s)?\b/,
    /\bentry[-\s]?level\b/,
    /\b0\s*[-–to]\s*2\s*(year|yr|yrs|years)\b/,
    /\b1\s*[-–to]\s*2\s*(year|yr|yrs|years)\b/,
    /\b0\s*[-–to]\s*1\s*(year|yr|yrs|years)\b/,
    /\bup\s*to\s*2\s*(year|yr|yrs|years)\b/,
    /\bupto\s*2\s*(year|yr|yrs|years)\b/,
    /\bunder\s*2\s*(year|yr|yrs|years)\b/,
    /\bless\s*than\s*2\s*(year|yr|yrs|years)\b/,
    /\b(6|12)\s*(months|mos|mo)\b/,
    /\b2\s*(year|yr|yrs)\b(?!\s*(\+|plus|or\s*more|and\s*above|min(imum)?|at\s*least))/,
    /\b0\s*(year|yr|yrs|years)\b/,
    /\b1\s*(year|yr|yrs)\b(?!\s*(\+|plus|or\s*more|and\s*above|min(imum)?|at\s*least))/
  ];

  const negative = [
    /\b2\s*(\+|plus|or\s*more|and\s*above|min(imum)?|at\s*least)\s*(year|yr|yrs|years)\b/,
    /\b1\s*[-–to]\s*[3-9]\s*(year|yr|yrs|years)\b/,
    /\b([3-9]|1[0-9])\s*(\+|plus)?\s*(year|yr|yrs|years)\b/,
    /\b(min|minimum|at\s*least)\s*([3-9]|1[0-9])\s*(year|yr|yrs|years)\b/,
    /\b([3-9]|1[0-9])\s*-\s*\d+\s*(year|yr|yrs|years)\b/,
    /\bexperience\s*[:\-]?\s*([3-9]|1[0-9])\s*(year|yr|yrs|years)\b/,
  ];

  if (negative.some(re => re.test(s))) return false;
  if (positive.some(re => re.test(s))) return true;
  return true; // rely on LI exp tag if years not mentioned
}

// ---------- persistent seen ----------
async function loadSeen() {
  if (!PERSIST_SEEN) return new Set();
  try {
    const raw = await fs.readFile(SEEN_FILE, "utf8");
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}
async function saveSeen(set) {
  if (!PERSIST_SEEN) return;
  await fs.writeFile(SEEN_FILE, JSON.stringify([...set], null, 2), "utf8");
}

// ---------- query execution ----------
async function runQuery({ title, exp, remoteOnly }) {
  const q = { ...BASE_QUERY, keyword: title };
  if (exp) q.experienceLevel = exp; // when exp is null => "any"
  if (remoteOnly) q.remoteFilter = "remote";

  const res = await linkedIn.query(q);
  console.log(`Fetched ${res.length} "${title}" ${exp || "anyExp"} ${remoteOnly ? "[remote]" : ""} @ India`);
  return res;
}

async function collectAll() {
  const tasks = [];
  for (const title of TITLES) {
    for (const exp of [...EXPERIENCES, null]) {
      tasks.push({ title, exp, remoteOnly: false });
      tasks.push({ title, exp, remoteOnly: true  });
    }
  }

  let idx = 0;
  const out = [];
  async function worker() {
    while (idx < tasks.length) {
      const t = tasks[idx++];
      try {
        out.push(...(await runQuery(t)));
      } catch (e) {
        console.log("Error for", t, e.message || e);
      }
      await sleep(PAUSE_BETWEEN_QUERIES_MS);
    }
  }
  const workers = Array.from({ length: QUERY_CONCURRENCY }, () => worker());
  await Promise.all(workers);
  return out;
}

async function main() {
  const seen = await loadSeen();

  // 1) collect
  let all = await collectAll();
  console.log(`Collected total: ${all.length}`);

  // 2) HARD DEDUPE
  all = uniqBy(all, jobKeyByIdFirst);
  console.log(`Unique by jobId/canonical: ${all.length}`);

  // 3) pre-filter
  const pre = all.filter(j => titleLikelyMatch(j.position) && isIndiaOrRemoteQuick(j));
  console.log(`Pre-filter (title + India/Remote): ${pre.length}`);
  if (!pre.length) return console.log("Nothing matched the pre-filter.");

  // 4) fetch descriptions
  await fetchAllDescriptions(pre);

  // 5) strict filters
  let filtered = pre.filter(j => {
    const desc = j.description || "";
    const title = j.position || "";
    return isIndiaOrRemote(j, desc) && roleMatches(title, desc) && experienceAllowed(`${title} ${desc}`);
  });

  if (SOFT_DEDUPE_BY_COMPANY_TITLE) {
    filtered = uniqBy(filtered, j => `${slug(j.company)}|${slug(j.position)}`);
  }

  filtered = uniqBy(filtered, jobKeyByIdFirst);
  console.log(`Kept after strict filters + dedupe: ${filtered.length}`);
  if (!filtered.length) return console.log("No rows matched strict filters.");

  // 6) shape rows
  const finalRows = filtered.map(j => {
    const d = j.description || "";
    const emails = extractEmails(d).join("; ");
    const phones = extractPhones(d).join("; ");
    const skills = extractSkills(d).join("; ");
    const is_remote =
      (/remote|work\s*from\s*home|wfh/i.test(j.location || "") ||
       /remote|work\s*from\s*home|wfh/i.test(d)) ? "Yes" : "No";

    const t = (j.position || "").toLowerCase();
    const matched_role = ROLE_PHRASES.find(p => t.includes(p) || d.toLowerCase().includes(p)) || "";
    const id = extractJobId(j.jobUrl) || canonicalUrl(j.jobUrl || "");

    return {
      li_job_id: id,
      company: j.company || "",
      title: j.position || "",
      matched_role,
      location: j.location || "",
      is_remote,
      date_posted: j.date || "",
      ago_time: j.agoTime || "",
      salary: j.salary || "",
      job_url: canonicalUrl(j.jobUrl || ""),
      contact_emails: emails,
      contact_phones: phones,
      skills,
      description: d
    };
  });

  // 7) incremental filter
  let outputRows = finalRows;
  if (INCREMENTAL_MODE) {
    outputRows = finalRows.filter(r => r.li_job_id && !seen.has(r.li_job_id));
    console.log(`New since last run: ${outputRows.length}`);
  }

  // 8) save CSV
  if (!outputRows.length) {
    console.log("Nothing new to save (incremental mode).");
  } else {
    const parser = new Parser({ fields: Object.keys(outputRows[0]) });
    const csv = parser.parse(outputRows);
    await fs.writeFile("results.csv", csv, "utf8");
    console.log(`Saved ${outputRows.length} jobs to results.csv`);
  }

  // 9) update seen
  if (PERSIST_SEEN) {
    for (const r of finalRows) {
      if (r.li_job_id) seen.add(r.li_job_id);
    }
    await saveSeen(seen);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
