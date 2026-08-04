import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { DEFAULT_SETTINGS, deepMerge } from "./config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");
export const DATA_DIR = path.join(ROOT, "data");

export function openDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(path.join(DATA_DIR, "zhbid.db"));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      url TEXT,
      source TEXT,
      category TEXT,
      company TEXT,
      location TEXT,
      amount TEXT,
      release_date TEXT,
      end_date TEXT,
      stage TEXT,
      keywords TEXT,
      score INTEGER DEFAULT 0,
      summary TEXT,
      company_info TEXT,
      raw TEXT,
      dedup_key TEXT UNIQUE,
      status TEXT DEFAULT 'new',
      starred INTEGER DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at);
    CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source);
    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);

    CREATE TABLE IF NOT EXISTS runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at TEXT,
      finished_at TEXT,
      status TEXT,
      message TEXT,
      new_count INTEGER DEFAULT 0,
      total_count INTEGER DEFAULT 0,
      source_stats TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS account_meta (
      source TEXT PRIMARY KEY,
      updated_at TEXT,
      username TEXT
    );
  `);
  return db;
}

function nowText() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`
  );
}

export function getSettings(db) {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  const stored = {};
  for (const row of rows) {
    try {
      stored[row.key] = JSON.parse(row.value);
    } catch {
      stored[row.key] = row.value;
    }
  }
  return deepMerge(DEFAULT_SETTINGS, stored);
}

export function saveSettings(db, patch) {
  const merged = deepMerge(getSettings(db), patch || {});
  const insert = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  for (const [key, value] of Object.entries(merged)) {
    insert.run(key, JSON.stringify(value));
  }
  return merged;
}

function prepareLead(row) {
  const lead = { ...row };
  lead.keywords = safeParse(row.keywords, []);
  lead.company_info = safeParse(row.company_info, null);
  return lead;
}

function safeParse(value, fallback) {
  if (value == null || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function addLeads(db, leads) {
  let inserted = 0;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO leads (
      title, url, source, category, company, location, amount,
      release_date, end_date, stage, keywords, score, summary,
      company_info, raw, dedup_key, status, starred, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', 0, ?, ?)
  `);
  const timestamp = nowText();
  for (const lead of leads) {
    const dedupKey =
      lead.dedup_key ||
      `${lead.source || "source"}|${lead.url || lead.title || ""}`.trim();
    const result = insert.run(
      String(lead.title || "").slice(0, 1000),
      lead.url || "",
      lead.source || "",
      lead.category || "",
      lead.company || "",
      lead.location || "",
      lead.amount || "",
      lead.release_date || "",
      lead.end_date || "",
      lead.stage || "",
      JSON.stringify(lead.keywords || []),
      lead.score || 0,
      lead.summary || "",
      lead.company_info ? JSON.stringify(lead.company_info) : "",
      lead.raw ? JSON.stringify(lead.raw) : "",
      dedupKey,
      timestamp,
      timestamp
    );
    inserted += Number(result.changes || 0);
  }
  return { inserted, total: leads.length };
}

export function listLeads(db, query = {}) {
  const conditions = [];
  const params = [];

  if (query.q) {
    conditions.push("(title LIKE ? OR company LIKE ? OR summary LIKE ?)");
    const like = `%${query.q}%`;
    params.push(like, like, like);
  }
  if (query.source) {
    conditions.push("source = ?");
    params.push(query.source);
  }
  if (query.category) {
    conditions.push("category = ?");
    params.push(query.category);
  }
  if (query.status) {
    conditions.push("status = ?");
    params.push(query.status);
  }
  if (query.starred === "1" || query.starred === "true") {
    conditions.push("starred = 1");
  }
  if (query.date_from) {
    conditions.push("date(release_date) >= date(?)");
    params.push(query.date_from);
  }
  if (query.date_to) {
    conditions.push("date(release_date) <= date(?)");
    params.push(query.date_to);
  }
  if (query.created_from) {
    conditions.push("date(created_at, 'localtime') >= date(?)");
    params.push(query.created_from);
  }
  if (query.created_to) {
    conditions.push("date(created_at, 'localtime') <= date(?)");
    params.push(query.created_to);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 30));
  const offset = (page - 1) * limit;

  const totalRow = db
    .prepare(`SELECT COUNT(*) AS c FROM leads ${where}`)
    .get(...params);
  const rows = db
    .prepare(
      `SELECT * FROM leads ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset)
    .map(prepareLead);

  return { rows, total: totalRow.c, page, limit };
}

export function getLead(db, id) {
  const row = db.prepare("SELECT * FROM leads WHERE id = ?").get(id);
  return row ? prepareLead(row) : null;
}

export function setLeadStatus(db, id, status) {
  const allowed = ["new", "viewed", "following", "quoted", "closed"];
  if (!allowed.includes(status)) return null;
  db.prepare("UPDATE leads SET status = ?, updated_at = ? WHERE id = ?").run(
    status,
    nowText(),
    id
  );
  return getLead(db, id);
}

export function toggleLeadStar(db, id) {
  const row = db.prepare("SELECT starred FROM leads WHERE id = ?").get(id);
  if (!row) return null;
  const starred = row.starred ? 0 : 1;
  db.prepare("UPDATE leads SET starred = ?, updated_at = ? WHERE id = ?").run(
    starred,
    nowText(),
    id
  );
  return getLead(db, id);
}

export function updateLeadCompanyInfo(db, id, info) {
  db.prepare(
    "UPDATE leads SET company_info = ?, updated_at = ? WHERE id = ?"
  ).run(JSON.stringify(info || {}), nowText(), id);
  return getLead(db, id);
}

export function deleteLead(db, id) {
  db.prepare("DELETE FROM leads WHERE id = ?").run(id);
}

export function createRun(db) {
  const result = db
    .prepare(
      "INSERT INTO runs (started_at, status, message, new_count, total_count, source_stats) VALUES (?, 'running', '', 0, 0, '{}')"
    )
    .run(nowText());
  return db.prepare("SELECT * FROM runs WHERE id = ?").get(Number(result.lastInsertRowid));
}

export function finishRun(db, runId, payload) {
  db.prepare(
    `UPDATE runs SET finished_at = ?, status = ?, message = ?, new_count = ?, total_count = ?, source_stats = ? WHERE id = ?`
  ).run(
    nowText(),
    payload.status || "done",
    payload.message || "",
    payload.newCount || 0,
    payload.totalCount || 0,
    JSON.stringify(payload.sourceStats || {}),
    runId
  );
  return db.prepare("SELECT * FROM runs WHERE id = ?").get(runId);
}

export function listRuns(db, limit = 30) {
  return db
    .prepare("SELECT * FROM runs ORDER BY id DESC LIMIT ?")
    .all(Math.min(100, Math.max(1, limit)))
    .map((row) => ({
      ...row,
      source_stats: safeParse(row.source_stats, {})
    }));
}

export function getLastRun(db) {
  return db.prepare("SELECT * FROM runs ORDER BY id DESC LIMIT 1").get();
}

export function getTodayRun(db) {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return db
    .prepare(
      "SELECT * FROM runs WHERE started_at LIKE ? AND status != 'running' ORDER BY id DESC LIMIT 1"
    )
    .get(`${today}%`);
}

export function setAccountMeta(db, source, username) {
  db.prepare(
    "INSERT INTO account_meta (source, updated_at, username) VALUES (?, ?, ?) ON CONFLICT(source) DO UPDATE SET updated_at = excluded.updated_at, username = excluded.username"
  ).run(source, nowText(), username || "");
}

export function getAccountMeta(db, source) {
  return db.prepare("SELECT * FROM account_meta WHERE source = ?").get(source) || null;
}

export function countBySource(db) {
  return db.prepare("SELECT source, COUNT(*) AS count FROM leads GROUP BY source ORDER BY count DESC").all();
}

export function countLeads(db, extra = "") {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM leads ${extra}`).get();
  return row.c;
}

export function getTodayNewCount(db) {
  return countLeads(
    db,
    "WHERE date(created_at, 'localtime') = date('now', 'localtime')"
  );
}
