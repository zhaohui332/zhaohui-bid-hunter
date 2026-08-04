import { addLeads } from "../db.js";
import {
  scoreText,
  stripHtml,
  extractCompanyFromTitle
} from "../matcher.js";
import { cookiesToHeader, readStorageState } from "../browser.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

const CHEMICAL_INDUSTRIES = new Set([7, 10, 69, 78, 105, 121, 144, 145]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchDetail(url, cookieHeader) {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Cookie: cookieHeader,
        Referer: "http://www.cceup.com/"
      }
    });
    const html = await res.text();
    const description =
      html.match(/<meta name="description" content="([^"]+)"/)?.[1] || "";
    const contacts = [];
    const contactRe = /(联系人|手机|电话|邮箱)[:：]\s*([^<&\n]{1,40})/g;
    let match;
    while ((match = contactRe.exec(html)) && contacts.length < 20) {
      contacts.push(match[0].trim());
    }
    const detailBlock = html.match(/<h2>项目详细介绍<\/h2>([\s\S]*?)<h2>/);
    const summary = stripHtml(description || detailBlock?.[1] || "");
    return { summary: summary.slice(0, 1200), contacts };
  } catch {
    return { summary: "", contacts: [] };
  }
}

async function collectList(url, cookieHeader, page, extraFields) {
  const body = new URLSearchParams({ page: String(page) });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      Cookie: cookieHeader,
      "X-Requested-With": "XMLHttpRequest",
      Referer: url,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
    },
    body
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function collectCCEUP({ db, settings, log }) {
  const state = readStorageState("cceup");
  const cookieHeader = cookiesToHeader(state);
  if (!cookieHeader) {
    log("中能联合：未保存登录会话，跳过");
    return { source: "中能联合", ok: false, message: "未登录", inserted: 0, total: 0 };
  }

  const schedule = settings.schedule || {};
  const minScore = settings.filters?.minScore ?? 2;
  const includeAll = Boolean(settings.filters?.includeAllChemical);
  const projectPages = Math.min(50, Math.max(1, schedule.cceupPages || 8));
  const dockPages = Math.min(50, Math.max(1, schedule.dockPages || 8));
  const detailLimit = Math.min(20, schedule.detailLimit || 10);
  const candidates = [];

  for (let page = 1; page <= projectPages; page++) {
    try {
      const json = await collectList("http://www.cceup.com/projects", cookieHeader, page);
      if (json.code !== 1) {
        log(`中能联合项目页第${page}页：${json.msg || "请求失败"}`);
        break;
      }
      for (const item of json.data?.list || []) {
        const title = item.ProjectName || "";
        const text = `${title} ${item.DictionaryName || ""} ${item.EngineeringState || ""}`;
        const { score, matched } = scoreText(text, settings.keywords);
        const chemical = CHEMICAL_INDUSTRIES.has(item.ProfessionType);
        if (score >= minScore || (includeAll && chemical)) {
          candidates.push({ item, title, score, matched, kind: "project" });
        }
      }
    } catch (error) {
      log(`中能联合项目页第${page}页：${error.message}`);
      break;
    }
    await sleep(350);
  }

  for (let page = 1; page <= dockPages; page++) {
    try {
      const json = await collectList("http://www.cceup.com/dock", cookieHeader, page);
      if (json.code !== 1) {
        log(`中能联合采购页第${page}页：${json.msg || "请求失败"}`);
        break;
      }
      for (const item of json.data?.list || []) {
        const title = item.ProductName || "";
        const text = `${title} ${item.PurchaseType || ""} ${item.CityName || ""}`;
        const { score, matched } = scoreText(text, settings.keywords);
        if (score >= minScore) {
          candidates.push({ item, title, score, matched, kind: "dock" });
        }
      }
    } catch (error) {
      log(`中能联合采购页第${page}页：${error.message}`);
      break;
    }
    await sleep(350);
  }

  const leadRows = [];
  let detailCount = 0;
  for (const candidate of candidates) {
    let detail = null;
    if (candidate.item.url && detailCount < detailLimit) {
      detail = await fetchDetail(candidate.item.url, cookieHeader);
      detailCount++;
    }

    if (candidate.kind === "project") {
      const item = candidate.item;
      leadRows.push({
        title: candidate.title,
        url: item.url,
        source: "中能联合",
        category: "项目托管",
        company: extractCompanyFromTitle(candidate.title),
        location: item.PCityName || "",
        amount: item.Investment
          ? `${item.Investment} ${item.MoneyUnit || "万元"}`
          : "",
        release_date: item.ReleaseTime || "",
        end_date: "",
        stage: stripHtml(item.EngineeringState || item.DictionaryName || ""),
        keywords: candidate.matched,
        score: candidate.score,
        summary: detail?.summary || "",
        company_info: detail?.contacts?.length
          ? { contacts: detail.contacts.slice(0, 20) }
          : null,
        dedup_key: `cceup:project:${item.ProjectID || item.ID || item.url}`
      });
    } else {
      const item = candidate.item;
      leadRows.push({
        title: candidate.title,
        url: item.url,
        source: "中能联合",
        category: stripHtml(item.PurchaseType || "项目采购"),
        company: extractCompanyFromTitle(candidate.title),
        location: item.CityName || "",
        amount: "",
        release_date: item.ReleaseTime || "",
        end_date: item.PurchaseEndTime || "",
        stage: stripHtml(item.PurchaseState || ""),
        keywords: candidate.matched,
        score: candidate.score,
        summary: detail?.summary || "",
        company_info: detail?.contacts?.length
          ? { contacts: detail.contacts.slice(0, 20) }
          : null,
        dedup_key: `cceup:dock:${item.id || item.ID || item.url}`
      });
    }
  }

  const result = addLeads(db, leadRows);
  log(`中能联合：采集 ${leadRows.length} 条候选，新增 ${result.inserted} 条`);
  return {
    source: "中能联合",
    ok: true,
    message: `新增 ${result.inserted} 条`,
    inserted: result.inserted,
    total: result.total
  };
}
