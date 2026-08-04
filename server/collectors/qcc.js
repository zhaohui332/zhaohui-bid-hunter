import { getLead, listLeads, updateLeadCompanyInfo } from "../db.js";
import { getSessionContext, readStorageState } from "../browser.js";
import { extractCompanyFromTitle } from "../matcher.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function enrichLeadWithQCC(db, leadId, log = () => {}) {
  const lead = getLead(db, leadId);
  if (!lead) return { ok: false, message: "线索不存在" };
  const state = readStorageState("qcc");
  if (!state) return { ok: false, message: "请先登录企查查" };

  const company =
    lead.company || extractCompanyFromTitle(lead.title) || lead.title.slice(0, 30);
  if (!company) return { ok: false, message: "未识别到企业名称" };

  const context = await getSessionContext("qcc", { headless: true });
  const page = await context.newPage();
  try {
    await page.goto(`https://www.qcc.com/search?key=${encodeURIComponent(company)}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    await page.waitForTimeout(3500);

    let info = null;
    const selectors = [
      ".company-list-item",
      ".company_list",
      ".search_result",
      'a[href*="/firm/"]'
    ];
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if ((await locator.count()) > 0) {
        const text = await locator.innerText();
        const link = await locator.locator("a").first().getAttribute("href");
        info = {
          company,
          qccUrl: link ? new URL(link, "https://www.qcc.com").href : "",
          snapshot: text.replace(/\s+/g, " ").trim().slice(0, 1500)
        };
        break;
      }
    }

    if (!info) {
      const body = await page.locator("body").innerText();
      if (/验证|安全|异常/i.test(body)) {
        return { ok: false, message: "企查查触发验证，请重新登录或稍后重试" };
      }
      return { ok: false, message: "企查查未返回企业结果" };
    }

    updateLeadCompanyInfo(db, leadId, info);
    log(`企查查补充 ${company} 完成`);
    return { ok: true, info };
  } catch (error) {
    return { ok: false, message: error.message };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function enrichNewLeadsWithQCC(db, limit = 3, log = () => {}) {
  const state = readStorageState("qcc");
  if (!state) return { ok: false, message: "请先登录企查查" };
  const page = await listLeads(db, { status: "new", limit, page: 1 });
  const results = [];
  for (const lead of page.rows) {
    const result = await enrichLeadWithQCC(db, lead.id, log);
    results.push(result);
    await sleep(2200);
  }
  return { ok: true, results };
}
