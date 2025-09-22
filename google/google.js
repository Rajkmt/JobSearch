// Robust Google CSE fresher job fetcher — India + India-remote — quota-safe
require("dotenv").config();
const axios = require("axios");
const cheerio = require("cheerio");
//const { Parser } = require("json2csv");
const { Parser } = require("@json2csv/plainjs");


const fs = require("fs/promises");
const path = require("path");

// ---------------- CONFIG ----------------
const GOOGLE_KEY = process.env.GOOGLE_CSE_KEY || "";
const GOOGLE_CX = process.env.GOOGLE_CX || "";

if (!GOOGLE_KEY || !GOOGLE_CX) {
  console.error("❌ Missing GOOGLE_CSE_KEY or GOOGLE_CX in .env");
  process.exit(1);
}

// how far back: "d1" (24h), "d7" (7 days), "w2" (2 weeks) etc.
const DATE_RESTRICT = process.env.DATE_RESTRICT || "d7";

// daily safety cap (free tier ~100/day). Stay below to avoid 429.
const DAILY_QUERY_BUDGET = Number(process.env.DAILY_QUERY_BUDGET || 90);

// results pages per role per cluster (1 => first page only; 2 => start=1,11)
const MAX_PAGES_PER_ROLE = Number(process.env.MAX_PAGES_PER_ROLE || 2);

// results per page (Google CSE supports up to 10)
const RESULTS_PER_PAGE = 10;

// Output
const OUT_CSV = process.env.OUT_CSV || "google_jobs.csv";

// Roles (comma-separated in .env)
const ROLE_TITLES = (process.env.ROLES ||
  "Junior Java Developer, Junior Software Developer, Junior Developer, Graduate Engineer Trainee, Software Trainee, QA Engineer, QA Tester, Frontend Engineer, Backend Engineer, Full Stack Engineer, Python Developer"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// Block big aggregators (we want ATS/company pages)
const BLOCKED_DOMAINS = [
  "linkedin.",
  "indeed.",
  "naukri.",
  "glassdoor.",
  "shine.",
  "bayt.",
  "adzuna.",
  "apna.",
  "prosple.",
  "instahyre.",
  "cutshort.",
  "angel.co",
  "wellfound",
  "timesjobs.",
  "foundit.",
  "monster.",
  "ziprecruiter.",
  "remoterocketship.",
];

// ATS/company careers clusters (we OR these inside the query)
const ATS_SITES = [
  "site:boards.greenhouse.io",
  "site:jobs.lever.co",
  "site:*.myworkdayjobs.com",
  "site:jobs.ashbyhq.com",
  "site:smartrecruiters.com",
  "site:jobs.icims.com",
  "site:*.taleo.net",
  "site:*.successfactors.com",
  "site:*.oraclecloud.com",
  "site:apply.workable.com",
  "site:*.bamboohr.com",
  "site:*.recruitee.com",
  "site:jobs.jobvite.com",
  "site:*.pinpoint.xyz",
  "site:*.teamtailor.com",
  "site:*.breezy.hr",
  "site:*.eightfold.ai",

  // generic company careers fallbacks
  "inurl:/careers/",
  "inurl:/career/",
  "inurl:/jobs/",
  "inurl:/job/",
];

// fresher include/exclude signals
const INCLUDE_TOKENS = [
  "fresher",
  "freshers",
  "graduate",
  "trainee",
  "entry level",
  "entry-level",
  "0-1 year",
  "0 to 1 year",
  "0–1 year",
  "0 — 1 year",
  "0-2 year",
  "0 to 2 year",
  "0–2 year",
  "0 — 2 year",
  "junior",
  "intern",
];

const EXCLUDE_TOKENS = [
  "senior",
  "sr.",
  "sr ",
  "lead",
  "principal",
  "architect",
  "manager",
  "head",
  "director",
  " engineer ii",
  " engineer iii",
  " engineer iv",
  " ii -",
  " iii -",
  " iv -",
  " mid level",
  "mid-level",
  "staff",
];

// location tokens: India & remote-with-India signals
const INDIA_REMOTE = [
  "India",
  "Remote India",
  "Remote - India",
  "Remote in India",
  "Anywhere in India",
  "Work from India",
  "IST",
  "India Standard Time",
  "UTC+5:30",
  "Asia/Kolkata",
  "Bengaluru",
  "Bangalore",
  "Hyderabad",
  "Pune",
  "Chennai",
  "Mumbai",
  "Navi Mumbai",
  "Gurgaon",
  "Gurugram",
  "Noida",
  "Delhi",
  "NCR",
  "Kolkata",
  "Ahmedabad",
  "Jaipur",
  "Indore",
  "Kochi",
];

// cache file to avoid duplicates and track today’s queries
const CACHE_DIR = ".cache";
const STATE_FILE = path.join(CACHE_DIR, "google_cse_state.json");

// ---------------- UTILS ----------------
const lower = (s) => (s || "").toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function domainFrom(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isBlocked(url) {
  const d = domainFrom(url);
  return BLOCKED_DOMAINS.some((b) => d.includes(b));
}

function fresherPositive(title, snippet) {
  const t = lower(title);
  const d = lower(snippet || "");
  const inc = INCLUDE_TOKENS.some((k) => t.includes(k) || d.includes(k));
  const exc = EXCLUDE_TOKENS.some((k) => t.includes(k) || d.includes(k));
  return inc && !exc;
}

function looksLikeCareerOrATS(url) {
  const u = lower(url);
  return (
    ATS_SITES.some((s) => u.includes(s.replace(/^site:/, ""))) ||
    /\/careers?\/|\/jobs?\/|\/job\//i.test(u)
  );
}

// load/save state
async function loadState() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    const raw = await fs.readFile(STATE_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function saveState(obj) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(obj, null, 2), "utf8");
}

function cleanText(s, max = 1500) {
  if (!s) return "";
  const t = String(s).replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1) + "…" : t;
}

// ---------------- GOOGLE CSE WRAPPER ----------------
const cse = axios.create({
  baseURL: "https://www.googleapis.com/customsearch/v1",
  timeout: 10000,
});

// retry for 5xx/429-with-backoff (stop on daily quota)
async function cseRequest(params, attempt = 1) {
  try {
    const { data } = await cse.get("", { params });
    return data;
  } catch (err) {
    const res = err.response;
    if (!res) throw err;
    const code = res.status;
    const msg = res.data?.error?.message || res.statusText || "CSE error";

    // daily quota hard-stop
    if (code === 429 && /quota/i.test(msg) && /per day/i.test(msg)) {
      const e = new Error("DAILY_QUOTA_EXCEEDED");
      e.code = 429;
      throw e;
    }

    // transient errors -> backoff retry
    if ((code >= 500 && code < 600) || code === 429) {
      if (attempt <= 3) {
        const backoff =
          Math.min(30000, 1000 * Math.pow(2, attempt)) +
          Math.floor(Math.random() * 500);
        console.warn(
          `⚠️ ${code} ${msg} — retrying in ${Math.round(
            backoff / 1000
          )}s (attempt ${attempt})`
        );
        await sleep(backoff);
        return cseRequest(params, attempt + 1);
      }
    }

    // invalid key / not enabled / bad cx
    if (code === 400 || code === 403) {
      throw new Error(`CSE_AUTH_OR_CONFIG_ERROR: ${msg}`);
    }

    throw err;
  }
}

// sanity check
async function preflightCheck() {
  const params = {
    key: GOOGLE_KEY,
    cx: GOOGLE_CX,
    q: "test",
    num: 1,
    fields: "searchInformation/totalResults",
  };
  await cseRequest(params);
}

// build the OR groups
function orGroup(arr) {
  return (
    "(" + arr.map((x) => (/\s/.test(x) ? `"${x}"` : x)).join(" OR ") + ")"
  );
}

// main query builder
function buildQuery(role) {
  const fresher = orGroup([
    "fresher",
    "freshers",
    "graduate",
    "trainee",
    "entry level",
    "entry-level",
    "0-1 year",
    "0-2 year",
    "junior",
    "intern",
  ]);
  const locs = orGroup(INDIA_REMOTE);
  const ats = "(" + ATS_SITES.join(" OR ") + ")";
  return [role, fresher, locs, ats].join(" ");
}

// fetch with pagination
async function fetchPage(role, start) {
  const q = buildQuery(role);
  const params = {
    key: GOOGLE_KEY,
    cx: GOOGLE_CX,
    q,
    num: RESULTS_PER_PAGE,
    start,
    gl: "IN",
    lr: "lang_en",
    safe: "off",
    dateRestrict: DATE_RESTRICT,
    fields: "items(link,title,snippet,displayLink),searchInformation/totalResults",
  };
  return cseRequest(params);
}

// enrich job data from JSON-LD
async function enrichFromJsonLd(url) {
  try {
    const { data: html } = await axios.get(url, {
      timeout: 10000,
      headers: { "User-Agent": "Mozilla/5.0" },
    });

    const $ = cheerio.load(html);
    const blocks = [];

    $('script[type="application/ld+json"]').each((_, el) => {
      try {
        blocks.push(JSON.parse($(el).text()));
      } catch {}
    });

    for (const j of blocks) {
      const obj = Array.isArray(j) ? j[0] : j;
      if (!obj) continue;
      const type = obj["@type"];
      const hasJob =
        type === "JobPosting" ||
        (Array.isArray(type) && type.includes("JobPosting"));
      if (hasJob) {
        return {
          company: obj.hiringOrganization?.name || null,
          title: obj.title || null,
          posted_at: obj.datePosted || null,
          location: Array.isArray(obj.jobLocation)
            ? obj.jobLocation
                .map((l) => l?.address?.addressLocality)
                .filter(Boolean)
                .join(", ")
            : obj.jobLocation?.address?.addressLocality || null,
          description: obj.description
            ? cheerio.load(obj.description).text().trim()
            : null,
        };
      }
    }
  } catch {}
  return {};
}

// ---------------- MAIN ----------------
(async () => {
  // Preflight: catch invalid key/cx early
  try {
    await preflightCheck();
  } catch (e) {
    console.error("❌ Preflight failed:", e.message);
    console.error(
      " • Ensure the Custom Search JSON API is ENABLED for your project"
    );
    console.error(" • Use a valid API key and a valid Programmable Search Engine CX");
    console.error(" • If you just created/edited the key, wait a minute and retry");
    process.exit(1);
  }

  // Load/initialize daily state
  const today = new Date().toISOString().slice(0, 10);
  const state = await loadState();
  if (state.date !== today) {
    state.date = today;
    state.queries_made = 0;
    state.seen_urls = [];
  }

  const seen = new Set(state.seen_urls || []);
  let budget = Math.max(0, DAILY_QUERY_BUDGET - (state.queries_made || 0));

  if (budget <= 0) {
    console.log("⏹️ Daily budget already consumed. Try again tomorrow.");
    process.exit(0);
  }

  const rows = [];
  const pageStarts = Array.from(
    { length: MAX_PAGES_PER_ROLE },
    (_, i) => 1 + i * RESULTS_PER_PAGE
  );

  try {
    for (const role of ROLE_TITLES) {
      for (const start of pageStarts) {
        if (budget <= 0) break;
        await sleep(250);

        let data;
        try {
          data = await fetchPage(role, start);
        } catch (e) {
          if (e.message === "DAILY_QUOTA_EXCEEDED" || e.code === 429) {
            console.error("⏹️ Daily quota exceeded. Saving partial results.");
            budget = 0;
            break;
          }
          console.warn(
            `⚠️ Skipping page (role="${role}" start=${start}): ${e.message}`
          );
          continue;
        }

        state.queries_made = (state.queries_made || 0) + 1;
        budget--;

        const items = data.items || [];
        for (const it of items) {
          const url = it.link;
          if (!url) continue;
          if (seen.has(url)) continue;
          if (isBlocked(url)) continue;
          if (!looksLikeCareerOrATS(url)) continue;

          const title = it.title || "";
          const snippet = it.snippet || "";
          if (!fresherPositive(title, snippet)) continue;

          // Enrich lightly
          let extra = {};
          try {
            extra = await enrichFromJsonLd(url);
          } catch {}

          const company =
            extra.company || (it.displayLink ? it.displayLink.replace(/^www\./, "") : "");
          const location = extra.location || "";
          const posted_at = extra.posted_at || "";
          const description = cleanText(extra.description || snippet);

          rows.push({
            source: "google_jobs",
            g_job_id: Buffer.from(
              JSON.stringify({ job_title: title, company_name: company, url })
            ).toString("base64"),
            company,
            title,
            location,
            posted_at,
            via: it.displayLink || "",
            job_url: url,
            description,
          });

          seen.add(url);
        }
      }
      if (budget <= 0) break;
    }
  } finally {
    // persist state and write CSV
    state.seen_urls = Array.from(seen);
    await saveState(state);

    const fields = [
      "source",
      "g_job_id",
      "company",
      "title",
      "location",
      "posted_at",
      "via",
      "job_url",
      "description",
    ];

    const parser = new Parser({ fields, quote: '"', withBOM: true });
    const csv = parser.parse(rows);
    await fs.writeFile(OUT_CSV, csv, "utf8");

    console.log(`✅ Saved ${rows.length} rows -> ${OUT_CSV}`);
    console.log(`ℹ️ Queries used today: ${state.queries_made}/${DAILY_QUERY_BUDGET}`);
  }
})();
