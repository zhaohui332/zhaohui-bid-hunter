import {
  createRun,
  finishRun,
  getSettings
} from "./db.js";
import { collectCCEUP } from "./collectors/cceup.js";
import { collectCebpubservice } from "./collectors/cebpubservice.js";
import { collectCncecyc } from "./collectors/cncecyc.js";
import { collectWebsearch } from "./collectors/websearch.js";
import { enrichNewLeadsWithQCC } from "./collectors/qcc.js";
import { enrichNewLeadsWithShuidi } from "./collectors/shuidi.js";

let currentRun = null;

export function isScanning() {
  return Boolean(currentRun);
}

export function getCurrentRun() {
  return currentRun;
}

export function runScanNow(db, options = {}) {
  if (currentRun) {
    return { started: false, runId: currentRun.id };
  }
  const run = createRun(db);
  currentRun = run;
  runScanAsync(db, run, options).catch((error) => {
    const logs = `扫描异常：${error.message}`;
    try {
      finishRun(db, run.id, {
        status: "error",
        message: logs,
        newCount: 0,
        totalCount: 0,
        sourceStats: {}
      });
    } catch {}
    currentRun = null;
  });
  return { started: true, runId: run.id };
}

async function runScanAsync(db, run, options = {}) {
  const settings = getSettings(db);
  const logs = [];
  const log = (message) => {
    const line = `[${new Date().toLocaleTimeString("zh-CN", { hour12: false })}] ${message}`;
    logs.push(line);
  };

  const collectors = [];
  if (settings.sources?.cceup) collectors.push(collectCCEUP);
  if (settings.sources?.cebpubservice) collectors.push(collectCebpubservice);
  if (settings.sources?.cncecyc) collectors.push(collectCncecyc);
  if (settings.sources?.websearch) collectors.push(collectWebsearch);

  const settled = await Promise.allSettled(
    collectors.map((collector) =>
      collector({ db, settings, log }).catch((error) => ({
        ok: false,
        message: error.message,
        inserted: 0,
        total: 0
      }))
    )
  );

  const sourceStats = {};
  let newCount = 0;
  let totalCount = 0;
  for (const result of settled) {
    const value = result.status === "fulfilled" ? result.value : null;
    if (value) {
      sourceStats[value.source || "未知来源"] = value.message || (value.ok ? "完成" : "失败");
      newCount += value.inserted || 0;
      totalCount += value.total || 0;
    } else {
      sourceStats["扫描异常"] = String(result.reason?.message || "未知错误");
    }
  }

  if (settings.sources?.qcc && newCount > 0) {
    try {
      const enrichResult = await enrichNewLeadsWithQCC(db, 3, log);
      sourceStats["企查查"] = enrichResult.ok ? "已补充 3 条企业信息" : enrichResult.message;
    } catch (error) {
      sourceStats["企查查"] = error.message;
    }
  }

  if (settings.sources?.shuidi && newCount > 0) {
    try {
      const enrichResult = await enrichNewLeadsWithShuidi(db, 3, log);
      sourceStats["水滴信用"] = enrichResult.ok ? "已补充 3 条企业信息" : enrichResult.message;
    } catch (error) {
      sourceStats["水滴信用"] = error.message;
    }
  }

  finishRun(db, run.id, {
    status: "done",
    message: logs.join("\n"),
    newCount,
    totalCount,
    sourceStats
  });
  currentRun = null;
  return run.id;
}
