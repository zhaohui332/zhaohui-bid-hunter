import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db.js";

const sessions = new Map();

export async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    throw new Error("Playwright 未安装，请先运行安装脚本");
  }
}

function statePath(source) {
  return path.join(DATA_DIR, `storage-${source}.json`);
}

function profilePath(source) {
  return path.join(DATA_DIR, `browser-${source}`);
}

export function readStorageState(source) {
  try {
    return JSON.parse(fs.readFileSync(statePath(source), "utf8"));
  } catch {
    return null;
  }
}

export function writeStorageState(source, state) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(statePath(source), JSON.stringify(state));
}

export function clearStorageState(source) {
  fs.rmSync(statePath(source), { force: true });
}

export function cookiesToHeader(state) {
  const cookies = state?.cookies || [];
  return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}

export async function closeSession(source) {
  const session = sessions.get(source);
  if (!session) return;
  try {
    await session.context.close();
  } catch {}
  sessions.delete(source);
}

export async function openLoginSession(source, url, secret = {}) {
  await closeSession(source);
  const pw = await loadPlaywright();
  const context = await pw.chromium.launchPersistentContext(profilePath(source), {
    headless: false,
    viewport: { width: 1280, height: 860 },
    locale: "zh-CN"
  });
  const existing = readStorageState(source);
  if (existing?.cookies?.length) {
    try {
      await context.addCookies(existing.cookies);
    } catch {}
  }
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});

  if (secret.username && secret.password) {
    try {
      const usernameInput = page
        .locator(
          'input[name="username"], input[name="account"], input[name="phone"], input[name="user_name"], input[type="text"]'
        )
        .first();
      await usernameInput.fill(secret.username, { timeout: 5000 });
      const passwordInput = page.locator('input[type="password"]').first();
      await passwordInput.fill(secret.password, { timeout: 5000 });
    } catch {}
  }

  const session = { source, context, openedAt: Date.now() };
  sessions.set(source, session);
  return session;
}

export async function captureSession(source) {
  const session = sessions.get(source);
  if (!session) {
    const state = readStorageState(source);
    if (state) return state;
    throw new Error("没有打开的登录窗口");
  }
  const state = await session.context.storageState();
  writeStorageState(source, state);
  await closeSession(source);
  return state;
}

export async function cancelLogin(source) {
  await closeSession(source);
}

export async function getSessionContext(source, { headless = true } = {}) {
  if (sessions.has(source)) {
    return sessions.get(source).context;
  }
  const pw = await loadPlaywright();
  const context = await pw.chromium.launchPersistentContext(profilePath(source), {
    headless,
    locale: "zh-CN"
  });
  const state = readStorageState(source);
  if (state?.cookies?.length) {
    try {
      await context.addCookies(state.cookies);
    } catch {}
  }
  sessions.set(source, { source, context });
  return context;
}

export async function closeAllSessions() {
  const sources = [...sessions.keys()];
  for (const source of sources) {
    await closeSession(source);
  }
}
