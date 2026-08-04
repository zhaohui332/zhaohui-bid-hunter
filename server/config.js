export const DEFAULT_SETTINGS = {
  keywords: [
    "钢衬四氟",
    "钢衬PE",
    "钢衬PO",
    "衬四氟",
    "衬氟",
    "储罐",
    "反应釜",
    "塔器",
    "管道",
    "搅拌罐",
    "膨胀节"
  ],
  schedule: {
    enabled: true,
    time: "07:00",
    cceupPages: 8,
    dockPages: 8,
    cncecycPages: 6,
    daysBack: 7,
    webQueries: 6,
    detailLimit: 10
  },
  sources: {
    cceup: true,
    cebpubservice: true,
    cncecyc: true,
    websearch: true,
    qcc: false,
    shuidi: true
  },
  filters: {
    minScore: 2,
    includeAllChemical: false
  },
  notify: {
    enabled: false,
    provider: "pushplus",
    token: "",
    webhook: "",
    maxLeads: 10
  }
};

export function deepMerge(base, patch) {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch || {})) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
    ) {
      out[key] = deepMerge(base[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
