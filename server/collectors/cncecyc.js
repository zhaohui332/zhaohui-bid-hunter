import { addLeads } from "../db.js";
import {
  scoreText,
  stripHtml,
  extractCompanyFromTitle
} from "../matcher.js";

const BASE = "https://bid.cncecyc.com";
const CHANNEL_IDS =
  "221,222,223,224,225,226,227,228,229,230,231,232,233,237,238,239,240,241,242";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, "");
}

function parseCategory(title) {
  const text = String(title || "");
  if (text.includes("成交公告")) return "成交公告";
  if (text.includes("候选人")) return "成交候选人公示";
  if (text.includes("变更")) return "变更公告";
  if (text.includes("询比价")) return "询比价采购";
  if (text.includes("竞争性谈判")) return "竞争性谈判";
  if (text.includes("招标")) return "招标公告";
  if (text.includes("采购")) return "采购公告";
  return "业务公告";
}

function parseSearchPage(html) {
  const listBlock =
    html.match(/<ul id="list1">([\s\S]*?)<\/ul>/)?.[1] || html;
  const items = [];
  const itemRe =
    /<a id="\d+" href="([^"]+)" title="([^"]*)"[\s\S]*?<span class="bidLink">([\s\S]*?)<\/span>\s*<span>([^<]*)<\/span>/g;
  let match;
  while ((match = itemRe.exec(listBlock))) {
    const [, href, titleAttr, linkText, date] = match;
    items.push({
      url: new URL(href, BASE).href,
      title: stripHtml(titleAttr || linkText),
      date: stripHtml(date).trim()
    });
  }
  const pagesMatch = html.match(/当前<em>\d+<\/em>页\s*\/\s*共计<em>(\d+)<\/em>页/);
  const totalMatch = html.match(/当前页有 <span>(\d+)<\/span> 条查询结果/);
  return {
    items,
    totalPages: Number(pagesMatch?.[1] || 1),
    totalResults: Number(totalMatch?.[1] || 0)
  };
}

async function fetchSearchPage(keyword, pageNo) {
  const params = new URLSearchParams({
    kwd: keyword,
    channelIds: CHANNEL_IDS,
    pageNo: String(pageNo),
    pageSize: "10"
  });
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE}/cms/search.htm?${params.toString()}`, {
        headers: {
          "User-Agent": UA,
          "Accept-Language": "zh-CN,zh;q=0.9",
          Referer: `${BASE}/cms/index.htm`
        }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return parseSearchPage(await res.text());
    } catch (error) {
      lastError = error;
      if (attempt < 3) await sleep(800 * attempt);
    }
  }
  throw lastError || new Error("搜索请求失败");
}

async function fetchDetail(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "zh-CN,zh;q=0.9",
        Referer: `${BASE}/cms/search.htm`
      }
    });
    if (!res.ok) return { summary: "", contacts: [], deadline: "", location: "" };
    const html = await res.text();
    const block =
      html.match(/<div class="ninfo-con">([\s\S]*?)<\/div>\s*<div class="ip-link">/)?.[1] ||
      html.match(/<div class="ninfo-con">([\s\S]*?)<\/div>/)?.[1] ||
      "";
    const text = stripHtml(block);
    const compact = normalizeText(text);
    const contacts = [];
    const contactRe = /(?:联系人|联\s*系\s*人|电话|邮箱)[：:]([^；;。，,]{1,50})/g;
    let contactMatch;
    while ((contactMatch = contactRe.exec(compact)) && contacts.length < 20) {
      contacts.push(`${contactMatch[0].slice(0, 2)}：${contactMatch[1]}`);
    }
    const deadlineMatch = compact.match(
      /(?:递交响应文件截止时间|响应文件递交截止时间|递交截止时间|投标截止时间|报名截止时间)[^\d]{0,40}(\d{4}-\d{2}-\d{2})(?:\s*(\d{1,2}:\d{2}))?/
    );
    const locationMatch = compact.match(/地址[：:]([^；;。]{2,80})/);
    return {
      summary: text.slice(0, 1200),
      contacts,
      deadline: deadlineMatch
        ? `${deadlineMatch[1]}${deadlineMatch[2] ? ` ${deadlineMatch[2]}` : ""}`
        : "",
      location: locationMatch?.[1] || ""
    };
  } catch {
    return { summary: "", contacts: [], deadline: "", location: "" };
  }
}

function dateWithinDays(dateText, daysBack) {
  if (!dateText) return true;
  const date = new Date(`${dateText}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime())) return true;
  const cutoff = Date.now() - (Number(daysBack) || 7) * 86400000;
  return date.getTime() >= cutoff;
}

export async function collectCncecyc({ db, settings, log }) {
  const schedule = settings.schedule || {};
  const minScore = settings.filters?.minScore ?? 2;
  const maxPages = Math.min(20, Math.max(1, schedule.cncecycPages || 6));
  const detailLimit = Math.min(20, schedule.detailLimit || 10);
  const daysBack = schedule.daysBack || 7;
  const keywords = Array.isArray(settings.keywords)
    ? settings.keywords.filter(Boolean)
    : [];
  const candidates = [];
  const seen = new Set();

  for (const keyword of keywords) {
    try {
      const first = await fetchSearchPage(keyword, 1);
      const pages = Math.min(maxPages, first.totalPages || 1);
      for (let page = 1; page <= pages; page++) {
        const data = page === 1 ? first : await fetchSearchPage(keyword, page);
        for (const item of data.items) {
          if (seen.has(item.url)) continue;
          seen.add(item.url);
          if (!dateWithinDays(item.date, daysBack)) continue;
          const { score, matched } = scoreText(item.title, settings.keywords);
          if (score >= minScore) {
            candidates.push({ ...item, score, matched });
          }
        }
        if (page > 1) await sleep(500);
      }
      log(`中国化学：关键词“${keyword}”搜索完成，累计候选 ${candidates.length} 条`);
    } catch (error) {
      log(`中国化学：关键词“${keyword}”失败：${error.message}`);
    }
    await sleep(600);
  }

  const leadRows = [];
  let detailCount = 0;
  for (const candidate of candidates) {
    let detail = { summary: "", contacts: [], deadline: "", location: "" };
    if (detailCount < detailLimit) {
      detail = await fetchDetail(candidate.url);
      detailCount++;
      await sleep(400);
    }
    const titleCompany = extractCompanyFromTitle(candidate.title);
    const compact = normalizeText(detail.summary);
    const buyerMatch = compact.match(/采购人[：:]([^；;。]{2,80})/);
    leadRows.push({
      title: candidate.title,
      url: candidate.url,
      source: "中国化学电子招标平台",
      category: parseCategory(candidate.title),
      company: titleCompany || buyerMatch?.[1] || "",
      location: detail.location || "",
      amount: "",
      release_date: candidate.date || "",
      end_date: detail.deadline || "",
      stage: parseCategory(candidate.title),
      keywords: candidate.matched,
      score: candidate.score,
      summary: detail.summary || "",
      company_info: detail.contacts?.length
        ? { contacts: detail.contacts.slice(0, 20) }
        : null,
      dedup_key: `cncecyc:${candidate.url}`
    });
  }

  const result = addLeads(db, leadRows);
  log(`中国化学：采集 ${leadRows.length} 条候选，新增 ${result.inserted} 条`);
  return {
    source: "中国化学电子招标平台",
    ok: true,
    message: `新增 ${result.inserted} 条`,
    inserted: result.inserted,
    total: result.total
  };
}
