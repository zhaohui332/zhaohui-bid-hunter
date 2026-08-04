import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db.js";

const secretsFile = path.join(DATA_DIR, "secrets.json");

export function readSecrets() {
  try {
    return JSON.parse(fs.readFileSync(secretsFile, "utf8"));
  } catch {
    return {};
  }
}

export function saveSecrets(patch) {
  const current = readSecrets();
  const merged = { ...current, ...patch };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(secretsFile, JSON.stringify(merged, null, 2), {
    mode: 0o600
  });
  return merged;
}

export function getSourceSecret(source) {
  return readSecrets()[source] || {};
}
