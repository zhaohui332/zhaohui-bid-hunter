import { getLead, listLeads, updateLeadCompanyInfo } from "../db.js";
import { getSessionContext, readStorageState } from "../browser.js";
import { extractCompanyFromTitle } from "../matcher.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function extractFirstCompany(page, company) {
  try {
    await page.goto("https://shuidi.cn/", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });
    await page.waitForTimeout(1800);
    await page.goto(
      `https://shuidi.cn/search?keywords=${encodeURIComponent(company)}`,
      { waitUntil: "domcontentloaded", timeout: 60000 }
    );
    await page.waitForSelector('a[href*="company_info="]:visible', {
      timeout: 25000
    });
    await page.waitForTimeout(1500);

    const model = page.locator('a[href*="company_info="]:visible').first();
    if ((await model.count()) === 0) {
      const totalText = await page
        .locator("#resultTotal")
        .innerText()
        .catch(() => "");
      const body = await page.locator("body").innerText().catch(() => "");
      if (/验证|安全|异常/i.test(body)) {
        return { ok: false, message: "水滴信用触发验证，请重新登录或稍后重试" };
      }
      return {
        ok: false,
        message: totalText ? `水滴信用未找到：${company}` : "水滴信用未返回结果"
      };
    }

    const href = await model.getAttribute("href");
    const text = (await model.innerText()).replace(/\s+/g, " ").trim();
    const name = (await model.locator(".name").innerText().catch(() => ""))
      .replace(/\s+/g, " ")
      .trim();
    const searchUrl = `https://shuidi.cn/search?keywords=${encodeURIComponent(company)}`;
    const parsedUrl = href ? new URL(href, "https://shuidi.cn") : null;
    const companyNo = parsedUrl?.searchParams.get("company_info");
    const info = {
      source: "水滴信用",
      company,
      name: name || company,
      shuidiUrl: companyNo ? parsedUrl.href : searchUrl,
      snapshot: text.slice(0, 1500)
    };
    return { ok: true, info };
  } catch (error) {
    return { ok: false, message: error.message };
  }
}

export async function enrichLeadWithShuidi(db, leadId, log = () => {}) {
  const lead = getLead(db, leadId);
  if (!lead) return { ok: false, message: "线索不存在" };

  const company =
    lead.company ||
    extractCompanyFromTitle(lead.title) ||
    lead.title.slice(0, 30);
  if (!company) return { ok: false, message: "未识别到企业名称" };

  let context;
  try {
    context = await getSessionContext("shuidi", { headless: true });
  } catch (error) {
    return { ok: false, message: `水滴信用浏览器未就绪：${error.message}` };
  }

  const page = await context.newPage();
  try {
    const result = await extractFirstCompany(page, company);
    if (result.ok) {
      updateLeadCompanyInfo(db, leadId, result.info);
      log(`水滴信用补充 ${company} 完成`);
    }
    return result;
  } finally {
    await page.close().catch(() => {});
  }
}

export async function enrichNewLeadsWithShuidi(db, limit = 3, log = () => {}) {
  const state = readStorageState("shuidi");
  if (!state) return { ok: false, message: "请先登录水滴信用" };
  const page = await listLeads(db, { status: "new", limit, page: 1 });
  const results = [];
  for (const lead of page.rows) {
    const result = await enrichLeadWithShuidi(db, lead.id, log);
    results.push(result);
    await sleep(2200);
  }
  return { ok: true, results };
}
