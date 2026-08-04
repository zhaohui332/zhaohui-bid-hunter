import crypto from "node:crypto";
import { addLeads } from "../db.js";
import {
  scoreText,
  stripHtml,
  extractCompanyFromTitle
} from "../matcher.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const BID_HINTS = [
  "招标",
  "采购",
  "询价",
  "询比",
  "报价",
  "项目",
  "公告",
  "中标",
  "结果",
  "竞标",
  "比选",
  "议标",
  "征集"
];
const BLOCKED_HOSTS = [
  "jdzj.com",
  "1688.com",
  "made-in-china.com",
  "alibaba.com",
  "youboy.com",
  "hongmenet.com",
  "b2b",
  "chemmade",
  "lookchem",
  "chemnet"
];

function hash(text) {
  return crypto.createHash("md5").update(String(text)).digest("hex").slice(0, 24);
}

function parseSogou(html) {
  const results = [];
  const segments = html.split('<div class="vrwrap"').slice(1);
  for (const segment of segments) {
    const titleMatch = segment.match(
      /<h3 class="vr-title">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/
    );
    if (!titleMatch) continue;
    const urlMatch = segment.match(/data-url="([^"]+)"/);
    const hrefMatch = segment.match(/<a[^>]*href="(\/link\?url=[^"]+)"/);
    const summaryMatch = segment.match(
      /class="[^"]*space-txt[^"]*"[^>]*>([\s\S]*?)<\/div>/
    );
    const citeMatch = segment.match(
      /<a class="citeLinkClass"[\s\S]*?<span>([^<]*)<\/span>\s*<span>([^<]*)<\/span>/
    );
    const title = stripHtml(titleMatch[1]);
    const rawUrl = stripHtml(urlMatch?.[1] || "");
    const url = rawUrl || (hrefMatch ? `https://www.sogou.com${stripHtml(hrefMatch[1])}` : "");
    if (!title || !url) continue;
    results.push({
      title,
      url,
      summary: stripHtml(summaryMatch?.[1] || ""),
      site: stripHtml(citeMatch?.[1] || ""),
      dateText: stripHtml(citeMatch?.[2] || "")
    });
  }
  return results.slice(0, 8);
}

async function fetchSogou(query) {
  const url = `https://www.sogou.com/web?query=${encodeURIComponent(query)}&num=10`;
  const tryFetch = async (attempt) => {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Accept-Language": "zh-CN,zh;q=0.9",
        Referer: "https://www.sogou.com/"
      }
    });
    const html = await res.text();
    const hasResults = html.includes('class="vrwrap"') || html.includes("js-page-results");
    const blocked = /antispider|请输入验证码|安全验证/i.test(html);
    if (!hasResults && !blocked && attempt < 1) {
      await sleep(5000);
      return tryFetch(attempt + 1);
    }
    return html;
  };
  return tryFetch(0);
}

function isBidLead(result) {
  const text = `${result.title} ${result.summary} ${result.site}`;
  try {
    const host = new URL(result.url).hostname;
    if (BLOCKED_HOSTS.some((blocked) => host.includes(blocked))) return false;
  } catch {}
  if (/￥|价格|厂家|批发|现货|产品中心|供应|欢迎咨询|多少钱|型号大全|产品展示/.test(text)) {
    return false;
  }
  return BID_HINTS.some((hint) => text.includes(hint));
}

export async function collectWebsearch({ db, settings, log }) {
  const schedule = settings.schedule || {};
  const maxQueries = Math.min(20, schedule.webQueries || 6);
  const minScore = settings.filters?.minScore ?? 2;
  const keywords = Array.isArray(settings.keywords) ? settings.keywords : [];
  const queries = [];

  for (const keyword of keywords.slice(0, 6)) {
    for (const suffix of [" 招标", " 采购"]) {
      queries.push(`${keyword}${suffix}`);
      if (queries.length >= maxQueries) break;
    }
    if (queries.length >= maxQueries) break;
  }

  const leadRows = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const query of queries) {
    try {
      const html = await fetchSogou(query);
      const results = parseSogou(html);
      for (const result of results) {
        if (!isBidLead(result)) continue;
        const text = `${result.title} ${result.summary} ${result.site}`;
        const { score, matched } = scoreText(text, settings.keywords);
        if (score < minScore) continue;
        leadRows.push({
          title: result.title,
          url: result.url,
          source: "全网搜索",
          category: "搜索引擎",
          company: extractCompanyFromTitle(result.title),
          location: "",
          amount: "",
          release_date: today,
          end_date: "",
          stage: query,
          keywords: matched,
          score,
          summary: result.summary.slice(0, 800),
          company_info: null,
          dedup_key: `sogou:${hash(result.url)}`
        });
      }
      log(`全网搜索 ${query}：返回 ${results.length} 条`);
    } catch (error) {
      log(`全网搜索 ${query}：${error.message}`);
    }
    await sleep(2600);
  }

  const result = addLeads(db, leadRows);
  log(`全网搜索：采集 ${leadRows.length} 条候选，新增 ${result.inserted} 条`);
  return {
    source: "全网搜索",
    ok: true,
    message: `新增 ${result.inserted} 条`,
    inserted: result.inserted,
    total: result.total
  };
}
