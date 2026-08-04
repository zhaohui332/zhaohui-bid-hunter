import { listLeads } from "./db.js";

function todayText() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function buildSummary(settings, extras = {}) {
  const notify = settings.notify || {};
  const maxLeads = Math.min(20, Math.max(1, notify.maxLeads || 10));
  const rows = listLeads(settings.db, {
    created_from: todayText(),
    created_to: todayText(),
    limit: maxLeads,
    page: 1
  }).rows;

  const today = new Date().toLocaleDateString("zh-CN", {
    month: "2-digit",
    day: "2-digit"
  });
  const title = `兆辉情报台 ${today} 新增 ${rows.length} 条线索`;
  const lines = [
    `今日新增线索 **${rows.length}** 条：`,
    "",
    ...rows.map((lead) => {
      const meta = [lead.source, lead.category, lead.release_date]
        .filter(Boolean)
        .join(" | ");
      return `### ${lead.title}\n> ${meta} ｜ 匹配分 ${lead.score}\n> [查看原文](${lead.url || "https://bid.cncecyc.com"})`;
    })
  ];

  if (extras.sourceStats && Object.keys(extras.sourceStats).length) {
    const stats = Object.entries(extras.sourceStats)
      .map(([source, message]) => `${source}：${message}`)
      .join("；");
    lines.push("", `来源统计：${stats}`);
  }

  return { title, content: lines.join("\n"), rows };
}

async function sendRaw(settings, payload) {
  const notify = settings.notify || {};
  const provider = notify.provider || "pushplus";

  if (provider === "wecom") {
    if (!notify.webhook) {
      return { ok: false, message: "请填写企业微信群机器人 Webhook" };
    }
    const body = {
      msgtype: "markdown",
      markdown: { content: payload.content }
    };
    const res = await fetch(notify.webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (data.errcode !== 0) {
      return { ok: false, message: data.errmsg || `HTTP ${res.status}` };
    }
    return { ok: true, message: "企业微信推送成功" };
  }

  if (provider === "serverchan") {
    if (!notify.token) {
      return { ok: false, message: "请填写 Server酱 SendKey" };
    }
    const form = new URLSearchParams({
      title: payload.title,
      desp: payload.content
    });
    const res = await fetch(
      `https://sctapi.ftqq.com/${encodeURIComponent(notify.token)}.send`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString()
      }
    );
    const data = await res.json().catch(() => ({}));
    if (data.code !== 0) {
      return { ok: false, message: data.message || `HTTP ${res.status}` };
    }
    return { ok: true, message: "Server酱推送成功" };
  }

  if (!notify.token) {
    return { ok: false, message: "请填写 PushPlus Token" };
  }
  const res = await fetch("https://www.pushplus.plus/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: notify.token,
      title: payload.title,
      content: payload.content,
      template: "markdown"
    })
  });
  const data = await res.json().catch(() => ({}));
  if (data.code !== 200) {
    return { ok: false, message: data.msg || `HTTP ${res.status}` };
  }
  return { ok: true, message: "PushPlus 推送成功" };
}

export async function sendLeadSummary(db, settings, extras = {}) {
  const withDb = { ...settings, db };
  const payload = buildSummary(withDb, extras);
  return sendRaw(withDb, payload);
}

export async function sendTestNotification(settings) {
  const payload = {
    title: "兆辉情报台测试通知",
    content: "### 微信推送测试\n\n设置成功，之后每天新增线索会推送到这里。"
  };
  return sendRaw(settings, payload);
}
