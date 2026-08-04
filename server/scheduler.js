import { getSettings, getTodayRun } from "./db.js";

export function nextRunTime(settings) {
  const schedule = settings.schedule || {};
  const [hour, minute] = String(schedule.time || "07:00")
    .split(":")
    .map((value) => Number(value) || 0);
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}

export function startScheduler(db, triggerScan) {
  let timer = null;

  function scheduleNext() {
    const settings = getSettings(db);
    if (!settings.schedule?.enabled) return;
    const delay = nextRunTime(settings).getTime() - Date.now();
    timer = setTimeout(() => {
      triggerScan({ auto: true });
      scheduleNext();
    }, delay);
  }

  function start() {
    const settings = getSettings(db);
    const now = new Date();
    const [hour, minute] = String(settings.schedule?.time || "07:00")
      .split(":")
      .map((value) => Number(value) || 0);
    const pastTime = now.getHours() * 60 + now.getMinutes() >= hour * 60 + minute;
    const alreadyRanToday = Boolean(getTodayRun(db));

    if (settings.schedule?.enabled && pastTime && !alreadyRanToday) {
      timer = setTimeout(() => {
        triggerScan({ auto: true, catchup: true });
        scheduleNext();
      }, 6000);
    } else {
      scheduleNext();
    }
  }

  start();

  return () => {
    if (timer) clearTimeout(timer);
  };
}
