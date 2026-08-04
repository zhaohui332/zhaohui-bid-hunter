import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROOT,
  DATA_DIR,
  openDb,
  getSettings,
  saveSettings,
  listLeads,
  getLead,
  setLeadStatus,
  toggleLeadStar,
  deleteLead,
  listRuns,
  getLastRun,
  getTodayRun,
  getTodayNewCount,
  countLeads,
  countBySource,
  getAccountMeta,
  setAccountMeta
} from "./db.js";
import { maskUsername } from "./matcher.js";
import {
  readStorageState,
  clearStorageState,
  openLoginSession,
  captureSession,
  cancelLogin
} from "./browser.js";
import { getSourceSecret, saveSecrets } from "./secrets.js";
import { runScanNow, isScanning } from "./scanner.js";
import { startScheduler, nextRunTime } from "./scheduler.js";
import { enrichLeadWithQCC } from "./collectors/qcc.js";
import { enrichLeadWithShuidi } from "./collectors/shuidi.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, "public");
const PORT = Number(process.env.PORT || 8710);

const db = openDb();

const LOGIN_URLS = {
  cceup: "http://www.cceup.com/login",
  qcc: "https://www.qcc.com/web/login",
  shuidi: "https://shuidi.cn/login",
  cncecyc: "https://supplier.cncecyc.com/tpbidder"
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function getAccountStatus() {
  const sources = ["cceup", "qcc", "shuidi", "cncecyc"];
  return sources.map((source) => {
    const state = readStorageState(source);
    const meta = getAccountMeta(db, source);
    const secret = getSourceSecret(source);
    return {
      source,
      loggedIn: Boolean(state),
      username: secret.username ? maskUsername(secret.username) : meta?.username || null,
      updatedAt: meta?.updated_at || null
    };
  });
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function handleExportCsv(res, url) {
  const leads = listLeads(db, {
    q: url.searchParams.get("q") || "",
    source: url.searchParams.get("source") || "",
    status: url.searchParams.get("status") || "",
    category: url.searchParams.get("category") || "",
    starred: url.searchParams.get("starred") || "",
    date_from: url.searchParams.get("date_from") || "",
    date_to: url.searchParams.get("date_to") || "",
    limit: 1000
  });
  const header = [
    "编号",
    "标题",
    "来源",
    "类型",
    "企业",
    "地区",
    "金额",
    "发布日期",
    "截止日期",
    "阶段",
    "关键词",
    "匹配分",
    "摘要",
    "链接",
    "企业信息",
    "状态"
  ];
  const lines = [header.map(csvEscape).join(",")];
  for (const lead of leads.rows) {
    lines.push(
      [
        lead.id,
        lead.title,
        lead.source,
        lead.category,
        lead.company,
        lead.location,
        lead.amount,
        lead.release_date,
        lead.end_date,
        lead.stage,
        (lead.keywords || []).join("、"),
        lead.score,
        lead.summary,
        lead.url,
        lead.company_info?.snapshot || (lead.company_info?.contacts || []).join("；") || "",
        lead.status
      ]
        .map(csvEscape)
        .join(",")
    );
  }
  const body = "\ufeff" + lines.join("\r\n");
  res.writeHead(200, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="zhbid-${Date.now()}.csv"`,
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function handleStatus(res) {
  const settings = getSettings(db);
  sendJson(res, 200, {
    ok: true,
    data: {
      settings,
      lastRun: getLastRun(db) || null,
      todayRun: getTodayRun(db) || null,
      todayNew: getTodayNewCount(db),
      total: countLeads(db),
      newCount: countLeads(db, "WHERE status = 'new'"),
      starred: countLeads(db, "WHERE starred = 1"),
      sourceStats: countBySource(db),
      accounts: getAccountStatus(),
      scanning: isScanning(),
      nextRunAt: nextRunTime(settings).toISOString()
    }
  });
}

async function handleApi(req, res, pathname, url, body) {
  const method = req.method || "GET";

  if (pathname === "/api/status" && method === "GET") {
    return handleStatus(res);
  }

  if (pathname === "/api/leads" && method === "GET") {
    const data = listLeads(db, Object.fromEntries(url.searchParams));
    return sendJson(res, 200, { ok: true, data });
  }

  if (pathname === "/api/runs" && method === "GET") {
    return sendJson(res, 200, {
      ok: true,
      data: listRuns(db, Number(url.searchParams.get("limit") || 30))
    });
  }

  if (pathname === "/api/settings" && method === "POST") {
    const settings = saveSettings(db, body);
    return sendJson(res, 200, { ok: true, data: settings });
  }

  if (pathname === "/api/run" && method === "POST") {
    const result = runScanNow(db, body || {});
    return sendJson(res, 200, { ok: true, data: result });
  }

  const leadMatch = pathname.match(/^\/api\/leads\/(\d+)$/);
  if (leadMatch && method === "GET") {
    const lead = getLead(db, Number(leadMatch[1]));
    return sendJson(res, lead ? 200 : 404, { ok: Boolean(lead), data: lead });
  }

  const starMatch = pathname.match(/^\/api\/leads\/(\d+)\/star$/);
  if (starMatch && method === "POST") {
    const lead = toggleLeadStar(db, Number(starMatch[1]));
    return sendJson(res, lead ? 200 : 404, { ok: Boolean(lead), data: lead });
  }

  const statusMatch = pathname.match(/^\/api\/leads\/(\d+)\/status$/);
  if (statusMatch && method === "POST") {
    const lead = setLeadStatus(db, Number(statusMatch[1]), body.status);
    return sendJson(res, lead ? 200 : 400, { ok: Boolean(lead), data: lead });
  }

  const deleteMatch = pathname.match(/^\/api\/leads\/(\d+)$/);
  if (deleteMatch && method === "DELETE") {
    deleteLead(db, Number(deleteMatch[1]));
    return sendJson(res, 200, { ok: true });
  }

  const enrichMatch = pathname.match(/^\/api\/leads\/(\d+)\/enrich$/);
  if (enrichMatch && method === "POST") {
    const result = await enrichLeadWithQCC(
      db,
      Number(enrichMatch[1]),
      (message) => console.log(message)
    );
    return sendJson(res, 200, { ok: result.ok, data: result });
  }

  const shuidiEnrichMatch = pathname.match(/^\/api\/leads\/(\d+)\/shuidi-enrich$/);
  if (shuidiEnrichMatch && method === "POST") {
    const result = await enrichLeadWithShuidi(
      db,
      Number(shuidiEnrichMatch[1]),
      (message) => console.log(message)
    );
    return sendJson(res, 200, { ok: result.ok, data: result });
  }

  if (pathname === "/api/accounts/status" && method === "GET") {
    return sendJson(res, 200, { ok: true, data: getAccountStatus() });
  }

  const credentialsMatch = pathname.match(/^\/api\/accounts\/(cceup|qcc|shuidi|cncecyc)\/credentials$/);
  if (credentialsMatch && method === "POST") {
    const source = credentialsMatch[1];
    saveSecrets({
      [source]: {
        username: body.username || "",
        password: body.password || ""
      }
    });
    setAccountMeta(db, source, body.username || "");
    return sendJson(res, 200, { ok: true });
  }

  const loginMatch = pathname.match(/^\/api\/accounts\/(cceup|qcc|shuidi|cncecyc)\/login$/);
  if (loginMatch && method === "POST") {
    const source = loginMatch[1];
    try {
      await openLoginSession(source, LOGIN_URLS[source], getSourceSecret(source));
      return sendJson(res, 200, { ok: true, data: { source, open: true } });
    } catch (error) {
      return sendJson(res, 500, { ok: false, message: error.message });
    }
  }

  const captureMatch = pathname.match(/^\/api\/accounts\/(cceup|qcc|shuidi|cncecyc)\/capture$/);
  if (captureMatch && method === "POST") {
    const source = captureMatch[1];
    try {
      await captureSession(source);
      setAccountMeta(db, source, getSourceSecret(source).username || "");
      return sendJson(res, 200, { ok: true });
    } catch (error) {
      return sendJson(res, 400, { ok: false, message: error.message });
    }
  }

  const logoutMatch = pathname.match(/^\/api\/accounts\/(cceup|qcc|shuidi|cncecyc)\/logout$/);
  if (logoutMatch && method === "POST") {
    clearStorageState(logoutMatch[1]);
    await cancelLogin(logoutMatch[1]);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === "/api/export.csv" && method === "GET") {
    return handleExportCsv(res, url);
  }

  sendJson(res, 404, { ok: false, message: "接口不存在" });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function serveStatic(req, res, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      return res.end("Not Found");
    }
    const ext = path.extname(filePath).toLowerCase();
    let body = data;
    if (ext === ".html") {
      const forwarded = String(req.headers["x-forwarded-prefix"] || "").replace(/\/+$/, "");
      if (forwarded) {
        const html = data
          .toString("utf8")
          .replace(
            "</head>",
            `<script>window.APP_BASE=${JSON.stringify(forwarded)}</script></head>`
          );
        body = Buffer.from(html, "utf8");
      }
    }
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": body.length
    });
    res.end(body);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = decodeURIComponent(url.pathname);
  try {
    if (pathname.startsWith("/api/")) {
      const body = ["POST", "PUT", "PATCH"].includes(req.method)
        ? await readBody(req)
        : {};
      return await handleApi(req, res, pathname, url, body);
    }
    return serveStatic(req, res, pathname);
  } catch (error) {
    sendJson(res, 500, { ok: false, message: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`兆辉投标情报台已启动：http://localhost:${PORT}`);
});

const stopScheduler = startScheduler(db, () => {
  runScanNow(db, { auto: true });
});

if (process.argv.includes("--scan-once")) {
  setTimeout(() => {
    runScanNow(db, { once: true });
  }, 500);
}

process.on("SIGINT", () => {
  stopScheduler();
  server.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopScheduler();
  server.close();
  process.exit(0);
});
