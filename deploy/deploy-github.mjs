import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const owner = process.env.GITHUB_USER || "zhaohui332";
const repo = process.env.GITHUB_REPO || "zhaohui-bid-hunter";
const token = process.env.GITHUB_TOKEN;
const branch = "main";

if (!token) {
  console.error("请设置 GITHUB_TOKEN 环境变量");
  process.exit(1);
}

async function github(pathname, options = {}) {
  const res = await fetch(`https://api.github.com${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "zhaohui-bid-hunter-deploy",
      ...(options.headers || {})
    }
  });
  return res;
}

function collectFiles(dir, base, out = []) {
  const ignored = new Set([
    ".git",
    "node_modules",
    "data",
    "work",
    ".DS_Store",
    ".env"
  ]);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name.endsWith(".log")) continue;
    const full = path.join(dir, entry.name);
    const rel = path.relative(base, full);
    if (entry.isDirectory()) collectFiles(full, base, out);
    else out.push(rel);
  }
  return out;
}

async function ensureRepo() {
  const res = await github(`/repos/${owner}/${repo}`);
  if (res.status === 404) {
    const create = await github("/user/repos", {
      method: "POST",
      body: JSON.stringify({
        name: repo,
        private: false,
        description: "兆辉投标情报台"
      })
    });
    if (!create.ok) {
      throw new Error(`创建仓库失败：${await create.text()}`);
    }
    console.log(`已创建仓库 ${owner}/${repo}`);
  } else if (!res.ok) {
    throw new Error(`检查仓库失败：${await res.text()}`);
  }
}

async function pushFiles() {
  const files = collectFiles(root, root).sort();

  const repoRes = await github(`/repos/${owner}/${repo}`);
  if (!repoRes.ok) {
    throw new Error(`检查仓库失败：${await repoRes.text()}`);
  }
  const repoInfo = await repoRes.json();
  if (repoInfo.size === 0) {
    for (const rel of files) {
      const full = path.join(root, rel);
      const content = fs.readFileSync(full).toString("base64");
      const pathName = rel
        .split(path.sep)
        .map((segment) => encodeURIComponent(segment))
        .join("/");
      let sha = null;
      const existing = await github(`/repos/${owner}/${repo}/contents/${pathName}`);
      if (existing.ok) {
        sha = (await existing.json()).sha;
      }
      const upload = await github(`/repos/${owner}/${repo}/contents/${pathName}`, {
        method: "PUT",
        body: JSON.stringify({
          message: "update: 接入中国化学电子招标平台",
          content,
          branch,
          ...(sha ? { sha } : {})
        })
      });
      if (!upload.ok) {
        throw new Error(`上传 ${rel} 失败：${await upload.text()}`);
      }
    }
    console.log(`已推送到 https://github.com/${owner}/${repo}`);
    return;
  }

  const entries = [];

  for (const rel of files) {
    const full = path.join(root, rel);
    const content = fs.readFileSync(full).toString("base64");
    const blob = await github(`/repos/${owner}/${repo}/git/blobs`, {
      method: "POST",
      body: JSON.stringify({ content, encoding: "base64" })
    });
    if (!blob.ok) throw new Error(`上传 ${rel} 失败：${await blob.text()}`);
    const data = await blob.json();
    entries.push({
      path: rel.split(path.sep).join("/"),
      mode: "100644",
      type: "blob",
      sha: data.sha
    });
  }

  const tree = await github(`/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({ tree: entries })
  });
  if (!tree.ok) throw new Error(`创建树失败：${await tree.text()}`);
  const treeSha = (await tree.json()).sha;

  const refRes = await github(`/repos/${owner}/${repo}/git/ref/heads/${branch}`);
  let parentSha = null;
  if (refRes.ok) {
    parentSha = (await refRes.json()).object.sha;
  }

  const commit = await github(`/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: "update: 接入水滴信用并完善部署脚本",
      tree: treeSha,
      parents: parentSha ? [parentSha] : []
    })
  });
  if (!commit.ok) throw new Error(`创建提交失败：${await commit.text()}`);
  const commitSha = (await commit.json()).sha;

  if (parentSha) {
    const update = await github(`/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commitSha, force: true })
    });
    if (!update.ok) throw new Error(`更新分支失败：${await update.text()}`);
  } else {
    const create = await github(`/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commitSha })
    });
    if (!create.ok) throw new Error(`创建分支失败：${await create.text()}`);
  }

  console.log(`已推送到 https://github.com/${owner}/${repo}`);
}

try {
  await ensureRepo();
  await pushFiles();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
