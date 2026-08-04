import { addLeads } from "../db.js";
import {
  scoreText,
  stripHtml,
  extractCompanyFromTitle
} from "../matcher.js";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36";

const CATEGORIES = [
  { id: 88, file: "bulletin", label: "采购公告" },
  { id: 89, file: "change", label: "变更公告" },
  { id: 90, file: "result", label: "结果公示" }
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseRows(html) {
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
  let match;
  while ((match = trRe.exec(html))) {
    const block = match[1];
    const link = block.match(/urlOpen\('([^']+)'\)"\s*title="([^"]+)"/);
    if (!link) continue;
    const tds = [...block.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((td) =>
      stripHtml(td[1])
    );
    if (tds.length < 5) continue;
    rows.push({
      uuid: link[1],
      title: stripHtml(link[2]),
      industry: tds[1] || "",
      area: (tds[2] || "").replace(/[【】]/g, "").trim(),
      sourceName: tds[3] || "",
      date: tds[4] || ""
    });
  }
  return rows;
}

export async function collectCebpubservice({ db, settings, log }) {
  const schedule = settings.schedule || {};
  const daysBack = schedule.daysBack || 7;
  const minScore = settings.filters?.minScore ?? 2;
  const now = new Date();
  const today = formatDate(now);
  const startDate = formatDate(new Date(now.getTime() - daysBack * 86400000));
  const endDate = today;
  const keywords = Array.isArray(settings.keywords) ? settings.keywords : [];
  const leadRows = [];

  for (const keyword of keywords) {
    for (const category of CATEGORIES) {
      const url =
        `https://bulletin.cebpubservice.com/xxfbcmses/search/${category.file}.html` +
        `?searchDate=${today}&dates=${daysBack}&word=${encodeURIComponent(keyword)}` +
        `&categoryId=${category.id}&industryName=&area=&status=&publishMedia=&sourceInfo=&showStatus=` +
        `&startcheckDate=${startDate}&endcheckDate=${encodeURIComponent(`${endDate} 23:59:59`)}&page=1`;
      try {
        const res = await fetch(url, {
          headers: {
            "User-Agent": UA,
            Accept: "text/html, application/xhtml+xml"
          }
        });
        const html = await res.text();
        const rows = parseRows(html);
        for (const row of rows) {
          if (row.date && row.date < startDate) continue;
          const text = `${row.title} ${row.industry} ${row.sourceName}`;
          const { score, matched } = scoreText(text, settings.keywords);
          if (score < minScore) continue;
          leadRows.push({
            title: row.title,
            url:
              `https://ctbpsp.com/#/bulletinDetail?uuid=${row.uuid}` +
              `&inpvalue=&dataSource=0&tenderAgency=`,
            source: "全国招标公共服务平台",
            category: category.label,
            company: extractCompanyFromTitle(row.title),
            location: row.area,
            amount: "",
            release_date: row.date,
            end_date: "",
            stage: category.label,
            keywords: matched,
            score,
            summary: `${row.industry} / ${row.sourceName}`,
            company_info: null,
            dedup_key: `cebpub:${row.uuid}`
          });
        }
      } catch (error) {
        log(`全国招标公共服务平台 ${keyword}/${category.label}：${error.message}`);
      }
      await sleep(650);
    }
  }

  const result = addLeads(db, leadRows);
  log(`全国招标公共服务平台：采集 ${leadRows.length} 条候选，新增 ${result.inserted} 条`);
  return {
    source: "全国招标公共服务平台",
    ok: true,
    message: `新增 ${result.inserted} 条`,
    inserted: result.inserted,
    total: result.total
  };
}
