const state = {
  view: "home",
  status: null,
  leadFilters: {
    q: "",
    source: "",
    status: "",
    date_from: "",
    date_to: "",
    page: 1
  },
  searchTimer: null
};

const STATUS_LABELS = {
  new: "待跟进",
  viewed: "已查看",
  following: "跟进中",
  quoted: "已报价",
  closed: "已关闭"
};

const ACCOUNT_LABELS = {
  cceup: "中能联合",
  qcc: "企查查",
  shuidi: "水滴信用",
  cncecyc: "中国化学电子招标平台"
};

function apiBase() {
  return window.APP_BASE || "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
    return map[char];
  });
}

async function api(path, options = {}) {
  const config = {
    headers: { "Content-Type": "application/json" },
    ...options
  };
  const fullPath = path.startsWith("http") ? path : `${apiBase()}${path}`;
  const res = await fetch(fullPath, config);
  const data = await res.json().catch(() => ({ ok: false, message: "响应解析失败" }));
  if (!res.ok && !data.ok) {
    throw new Error(data.message || `请求失败 ${res.status}`);
  }
  return data;
}

let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

async function refreshStatus() {
  try {
    const res = await api("/api/status");
    state.status = res.data;
    updateBadge();
  } catch (error) {
    showToast(error.message);
  }
}

function updateBadge() {
  const badge = document.getElementById("scanningBadge");
  if (!badge || !state.status) return;
  badge.textContent = state.status.scanning ? "采集中" : "待机";
  badge.classList.toggle("running", Boolean(state.status.scanning));
}

function switchView(view) {
  state.view = view;
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((section) => {
    section.classList.toggle("active", section.id === `view-${view}`);
  });
  renderCurrentView();
}

function renderCurrentView() {
  if (!state.status) return;
  if (state.view === "home") renderHome();
  if (state.view === "leads") renderLeads();
  if (state.view === "sources") renderSources();
  if (state.view === "settings") renderSettings();
  if (state.view === "runs") renderRuns();
  if (window.lucide) lucide.createIcons();
}

function renderHome() {
  const status = state.status;
  document.getElementById("homeDate").textContent = new Date().toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long"
  });
  document.getElementById("statToday").textContent = status.todayNew;
  document.getElementById("statNew").textContent = status.newCount;
  document.getElementById("statStarred").textContent = status.starred;
  document.getElementById("statTotal").textContent = status.total;

  const next = new Date(status.nextRunAt);
  document.getElementById("nextRun").innerHTML =
    `<span>${status.settings.schedule.enabled ? "每日自动采集" : "自动采集已关闭"}</span>` +
    `<strong>${next.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    })}</strong>`;

  const statusBox = document.getElementById("sourceStatus");
  statusBox.innerHTML = status.accounts
    .map((account) => {
      const label = ACCOUNT_LABELS[account.source] || account.source;
      const detail = account.loggedIn
        ? `已登录 ${account.username || ""}`
        : "未登录";
      return `<div class="source-status-item"><span class="status-dot ${account.loggedIn ? "on" : ""}"></span><span class="name">${label}</span><span class="detail">${detail}</span></div>`;
    })
    .join("");

  api("/api/leads?limit=8")
    .then((res) => {
      const data = res.data;
      document.getElementById("homeTotal").textContent = `共 ${data.total} 条`;
      const list = document.getElementById("homeList");
      if (!data.rows.length) {
        list.innerHTML = `<div class="empty">暂无线索</div>`;
        return;
      }
      list.innerHTML = data.rows
        .map((lead) => {
          const pillClass =
            lead.source === "中能联合"
              ? "cceup"
              : lead.source === "全国招标公共服务平台"
                ? "cebpub"
                : lead.source === "中国化学电子招标平台"
                  ? "cncecyc"
                : "web";
          return `<div class="lead-row">
            <div class="lead-main">
              <a class="lead-title" href="${escapeHtml(lead.url)}" target="_blank" rel="noreferrer">${escapeHtml(lead.title)}</a>
              <div class="lead-meta">
                <span class="pill ${pillClass}">${escapeHtml(lead.source)}</span>
                <span>${escapeHtml(lead.category || "-")}</span>
                <span>${escapeHtml(lead.company || "-")}</span>
                <span>${escapeHtml(lead.location || "")}</span>
                <strong>${escapeHtml(lead.release_date || "")}</strong>
              </div>
            </div>
            <span class="score ${lead.score >= 5 ? "high" : ""}">${lead.score}</span>
          </div>`;
        })
        .join("");
    })
    .catch((error) => showToast(error.message));
}

function sourceClass(source) {
  if (source === "中能联合") return "cceup";
  if (source === "全国招标公共服务平台") return "cebpub";
  if (source === "中国化学电子招标平台") return "cncecyc";
  return "web";
}

function leadActions(lead) {
  return `<div class="actions">
    <a class="icon-btn" href="${escapeHtml(lead.url)}" target="_blank" rel="noreferrer" title="打开原文"><i data-lucide="external-link"></i></a>
    <button class="icon-btn ${lead.starred ? "starred" : ""}" data-action="star" data-id="${lead.id}" title="${lead.starred ? "取消收藏" : "收藏"}"><i data-lucide="star"></i></button>
    <button class="icon-btn" data-action="status" data-id="${lead.id}" data-status="${lead.status === "following" ? "viewed" : "following"}" title="${lead.status === "following" ? "回到待处理" : "标记跟进"}"><i data-lucide="user-check"></i></button>
    <button class="icon-btn" data-action="enrich" data-id="${lead.id}" title="企查查查企业"><i data-lucide="building-2"></i></button>
    <button class="icon-btn" data-action="shuidi-enrich" data-id="${lead.id}" title="水滴信用查企业"><i data-lucide="droplet"></i></button>
    <button class="icon-btn danger" data-action="delete" data-id="${lead.id}" title="删除"><i data-lucide="trash-2"></i></button>
  </div>`;
}

async function renderLeads() {
  const filters = state.leadFilters;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  try {
    const res = await api(`/api/leads?${params.toString()}`);
    const data = res.data;
    const tbody = document.getElementById("leadTable");
    if (!data.rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">暂无匹配线索</td></tr>`;
    } else {
      tbody.innerHTML = data.rows
        .map((lead) => {
          return `<tr>
            <td class="cell-title">
              <a href="${escapeHtml(lead.url)}" target="_blank" rel="noreferrer">${escapeHtml(lead.title)}</a>
              <small>${escapeHtml(lead.company || "企业待识别")}</small>
            </td>
            <td>
              <div class="cell-tags">
                <span class="pill ${sourceClass(lead.source)}">${escapeHtml(lead.source)}</span>
                <span>${escapeHtml(lead.category || "-")}</span>
              </div>
            </td>
            <td>${escapeHtml(lead.location || "-")}</td>
            <td>${escapeHtml(lead.release_date || "-")}</td>
            <td><span class="score ${lead.score >= 5 ? "high" : ""}">${lead.score}</span></td>
            <td><span class="status-pill ${lead.status}">${STATUS_LABELS[lead.status] || lead.status}</span></td>
            <td>${leadActions(lead)}</td>
          </tr>`;
        })
        .join("");
    }
    const totalPages = Math.max(1, Math.ceil(data.total / data.limit));
    document.getElementById("leadPager").innerHTML =
      `<button class="btn btn-ghost" data-page="${data.page - 1}" ${data.page <= 1 ? "disabled" : ""}><i data-lucide="chevron-left"></i><span>上一页</span></button>` +
      `<span>第 ${data.page} / ${totalPages} 页</span>` +
      `<button class="btn btn-ghost" data-page="${data.page + 1}" ${data.page >= totalPages ? "disabled" : ""}><span>下一页</span><i data-lucide="chevron-right"></i></button>`;
    if (window.lucide) lucide.createIcons();
  } catch (error) {
    showToast(error.message);
  }
}

function renderSources() {
  const settings = state.status.settings;
  const accounts = state.status.accounts;
  for (const account of accounts) {
    const stateEl = document.getElementById(`${account.source}State`);
    if (stateEl) {
      stateEl.textContent = account.loggedIn ? "已登录" : "未登录";
      stateEl.classList.toggle("on", Boolean(account.loggedIn));
    }
  }
  document.querySelectorAll("[data-source-toggle]").forEach((toggle) => {
    const key = toggle.dataset.sourceToggle;
    toggle.checked = Boolean(settings.sources[key]);
  });
}

function renderSettings() {
  const settings = state.status.settings;
  document.getElementById("keywordsInput").value = (settings.keywords || []).join("\n");
  document.getElementById("scheduleTime").value = settings.schedule.time || "07:00";
  document.getElementById("scheduleEnabled").value = String(Boolean(settings.schedule.enabled));
  document.getElementById("cceupPages").value = settings.schedule.cceupPages || 8;
  document.getElementById("dockPages").value = settings.schedule.dockPages || 8;
  document.getElementById("cncecycPages").value = settings.schedule.cncecycPages || 6;
  document.getElementById("daysBack").value = settings.schedule.daysBack || 7;
  document.getElementById("webQueries").value = settings.schedule.webQueries || 6;
  document.getElementById("detailLimit").value = settings.schedule.detailLimit || 10;
  document.getElementById("minScore").value = settings.filters.minScore || 2;
  document.getElementById("includeAllChemical").value = String(Boolean(settings.filters.includeAllChemical));
}

async function renderRuns() {
  try {
    const res = await api("/api/runs?limit=30");
    const rows = res.data;
    const tbody = document.getElementById("runsTable");
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty">暂无运行记录</td></tr>`;
      return;
    }
    tbody.innerHTML = rows
      .map((run) => {
        const stats = Object.entries(run.source_stats || {})
          .map(([source, message]) => `${source}: ${message}`)
          .join("；");
        const statusText =
          run.status === "done" ? "完成" : run.status === "running" ? "采集中" : "失败";
        const statusClass =
          run.status === "done" ? "quoted" : run.status === "running" ? "following" : "new";
        return `<tr>
          <td>${escapeHtml(run.started_at)}</td>
          <td><span class="status-pill ${statusClass}">${statusText}</span></td>
          <td>${run.new_count}</td>
          <td>${run.total_count}</td>
          <td title="${escapeHtml(stats)}">${escapeHtml(stats.slice(0, 120))}</td>
          <td title="${escapeHtml(run.message || "")}">${escapeHtml((run.message || "").split("\n")[0] || "-")}</td>
        </tr>`;
      })
      .join("");
  } catch (error) {
    showToast(error.message);
  }
}

function bindEvents() {
  document.getElementById("tabs").addEventListener("click", (event) => {
    const tab = event.target.closest(".tab");
    if (tab) switchView(tab.dataset.view);
  });

  document.getElementById("runNow").addEventListener("click", async () => {
    try {
      const res = await api("/api/run", { method: "POST", body: "{}" });
      showToast(res.data.started ? "采集已开始" : "已有采集任务在运行");
      await refreshStatus();
      renderCurrentView();
    } catch (error) {
      showToast(error.message);
    }
  });

  document.getElementById("exportCsv").addEventListener("click", (event) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(state.leadFilters)) {
      if (value) params.set(key, value);
    }
    event.currentTarget.href = `${apiBase()}/api/export.csv?${params.toString()}`;
  });

  const searchInput = document.getElementById("leadSearch");
  searchInput.addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => {
      state.leadFilters.q = searchInput.value.trim();
      state.leadFilters.page = 1;
      renderLeads();
    }, 350);
  });

  document.getElementById("leadSource").addEventListener("change", (event) => {
    state.leadFilters.source = event.target.value;
    state.leadFilters.page = 1;
    renderLeads();
  });
  document.getElementById("leadStatus").addEventListener("change", (event) => {
    state.leadFilters.status = event.target.value;
    state.leadFilters.page = 1;
    renderLeads();
  });
  document.getElementById("leadDateFrom").addEventListener("change", (event) => {
    state.leadFilters.date_from = event.target.value;
    state.leadFilters.page = 1;
    renderLeads();
  });
  document.getElementById("leadDateTo").addEventListener("change", (event) => {
    state.leadFilters.date_to = event.target.value;
    state.leadFilters.page = 1;
    renderLeads();
  });
  document.getElementById("leadReset").addEventListener("click", () => {
    state.leadFilters = { q: "", source: "", status: "", date_from: "", date_to: "", page: 1 };
    document.getElementById("leadSearch").value = "";
    document.getElementById("leadSource").value = "";
    document.getElementById("leadStatus").value = "";
    document.getElementById("leadDateFrom").value = "";
    document.getElementById("leadDateTo").value = "";
    renderLeads();
  });

  document.getElementById("leadPager").addEventListener("click", (event) => {
    const button = event.target.closest("[data-page]");
    if (!button || button.disabled) return;
    const page = Number(button.dataset.page);
    if (page < 1) return;
    state.leadFilters.page = page;
    renderLeads();
  });

  document.getElementById("leadTable").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const { action, id } = button.dataset;
    try {
      if (action === "star") {
        await api(`/api/leads/${id}/star`, { method: "POST" });
      } else if (action === "status") {
        await api(`/api/leads/${id}/status`, {
          method: "POST",
          body: JSON.stringify({ status: button.dataset.status })
        });
      } else if (action === "delete") {
        if (!window.confirm("确认删除这条线索？")) return;
        await api(`/api/leads/${id}`, { method: "DELETE" });
      } else if (action === "enrich") {
        showToast("企查查查询中");
        const res = await api(`/api/leads/${id}/enrich`, { method: "POST" });
        showToast(res.ok ? "企业信息已补充" : res.data?.message || "查询未完成");
      } else if (action === "shuidi-enrich") {
        showToast("水滴信用查询中");
        const res = await api(`/api/leads/${id}/shuidi-enrich`, { method: "POST" });
        showToast(res.ok ? "水滴信用信息已补充" : res.data?.message || "查询未完成");
      }
      await refreshStatus();
      renderLeads();
    } catch (error) {
      showToast(error.message);
    }
  });

  document.getElementById("view-sources").addEventListener("click", async (event) => {
    const login = event.target.closest("[data-login]");
    const capture = event.target.closest("[data-capture]");
    const logout = event.target.closest("[data-logout]");
    const save = event.target.closest("[data-save-creds]");

    try {
      if (save) {
        const source = save.dataset.saveCreds;
        const username = document.getElementById(`${source}Username`).value.trim();
        const password = document.getElementById(`${source}Password`).value;
        if (!username || !password) {
          showToast("请填写账号和密码");
          return;
        }
        await api(`/api/accounts/${source}/credentials`, {
          method: "POST",
          body: JSON.stringify({ username, password })
        });
        showToast("账号已保存在本机");
      } else if (login) {
        const source = login.dataset.login;
        await api(`/api/accounts/${source}/login`, { method: "POST" });
        showToast("登录窗口已打开");
      } else if (capture) {
        const source = capture.dataset.capture;
        await api(`/api/accounts/${source}/capture`, { method: "POST" });
        showToast("登录会话已保存");
      } else if (logout) {
        const source = logout.dataset.logout;
        await api(`/api/accounts/${source}/logout`, { method: "POST" });
        showToast("会话已清除");
      }
      await refreshStatus();
      renderSources();
    } catch (error) {
      showToast(error.message);
    }
  });

  document.querySelectorAll("[data-source-toggle]").forEach((toggle) => {
    toggle.addEventListener("change", async () => {
      const key = toggle.dataset.sourceToggle;
      const sources = {
        ...state.status.settings.sources,
        [key]: toggle.checked
      };
      try {
        await api("/api/settings", {
          method: "POST",
          body: JSON.stringify({ sources })
        });
        await refreshStatus();
        showToast("采集来源已更新");
      } catch (error) {
        showToast(error.message);
        toggle.checked = !toggle.checked;
      }
    });
  });

  document.getElementById("settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const settings = {
      keywords: document
        .getElementById("keywordsInput")
        .value.split("\n")
        .map((item) => item.trim())
        .filter(Boolean),
      schedule: {
        enabled: document.getElementById("scheduleEnabled").value === "true",
        time: document.getElementById("scheduleTime").value || "07:00",
        cceupPages: Number(document.getElementById("cceupPages").value) || 8,
        dockPages: Number(document.getElementById("dockPages").value) || 8,
        cncecycPages: Number(document.getElementById("cncecycPages").value) || 6,
        daysBack: Number(document.getElementById("daysBack").value) || 7,
        webQueries: Number(document.getElementById("webQueries").value) || 6,
        detailLimit: Number(document.getElementById("detailLimit").value) || 10
      },
      filters: {
        minScore: Number(document.getElementById("minScore").value) || 2,
        includeAllChemical:
          document.getElementById("includeAllChemical").value === "true"
      }
    };
    try {
      await api("/api/settings", {
        method: "POST",
        body: JSON.stringify(settings)
      });
      await refreshStatus();
      showToast("设置已保存");
    } catch (error) {
      showToast(error.message);
    }
  });
}

async function init() {
  bindEvents();
  await refreshStatus();
  renderCurrentView();
  setInterval(async () => {
    await refreshStatus();
    if (state.view === "runs" && state.status?.scanning) renderRuns();
  }, 5000);
}

init();
