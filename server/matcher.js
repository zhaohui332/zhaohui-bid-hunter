const DEFAULT_TERMS = [
  { text: "钢衬四氟", weight: 5 },
  { text: "钢衬聚四氟乙烯", weight: 5 },
  { text: "钢衬PTFE", weight: 5 },
  { text: "钢衬PE", weight: 5 },
  { text: "钢衬PO", weight: 5 },
  { text: "碳钢衬四氟", weight: 4 },
  { text: "钢衬四氟储罐", weight: 6 },
  { text: "钢衬四氟管道", weight: 6 },
  { text: "衬四氟", weight: 3 },
  { text: "衬氟", weight: 2 },
  { text: "聚四氟乙烯", weight: 2 },
  { text: "PTFE", weight: 2 },
  { text: "氟塑料", weight: 2 },
  { text: "储罐", weight: 2 },
  { text: "反应釜", weight: 2 },
  { text: "塔器", weight: 2 },
  { text: "搅拌罐", weight: 2 },
  { text: "膨胀节", weight: 2 },
  { text: "管道", weight: 1 },
  { text: "阀门", weight: 1 },
  { text: "换热器", weight: 1 },
  { text: "脱硫", weight: 1 },
  { text: "酸洗", weight: 1 }
];

export function scoreText(text, userKeywords = []) {
  const source = String(text || "").toUpperCase();
  let score = 0;
  const matched = [];
  const seen = new Set();

  const terms = [
    ...DEFAULT_TERMS,
    ...(Array.isArray(userKeywords) ? userKeywords : [])
      .filter((item) => item && String(item).trim())
      .map((item) => ({ text: String(item).trim(), weight: 2 }))
  ];

  for (const term of terms) {
    const key = term.text.toUpperCase();
    if (!key || seen.has(key) || !source.includes(key)) continue;
    seen.add(key);
    score += term.weight;
    matched.push(term.text);
  }

  return { score, matched };
}

export function stripHtml(input) {
  return String(input || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractCompanyFromTitle(title) {
  const text = String(title || "").replace(/\s+/g, "");
  const patterns = [
    /([\u4e00-\u9fa5A-Za-z0-9（）()]{2,50}?(?:股份有限公司|有限责任公司|有限公司|公司|集团|研究院|设计院|工程公司|中心|厂))/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return "";
}

export function maskUsername(username) {
  const value = String(username || "");
  if (value.length <= 2) return value;
  return value.slice(0, 2) + "***";
}
