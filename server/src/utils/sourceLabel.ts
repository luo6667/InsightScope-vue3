/**
 * 📘 utils/sourceLabel.ts —— 数据来源（platform）推断
 *
 * feed 抓取时如果数据源里的评论都没给 platform，此前统一落成数据集的 platform
 * （URL 定时抓取建的数据集 platform 兜底值是「数据源」）→ 整批评论的来源全变成「数据源」，
 * 平台维度统计毫无信息量。这里按「条目自带 platform/source/channel（由 normalizeComment 处理）
 * → 数据集 platform（非兜底值）→ feedUrl 的 host」推断来源。
 */

/** 从数据源条目里取来源名（platform / source / channel 三个常见别名） */
export function platformFromItem(item: Record<string, unknown>): string {
  for (const key of ["platform", "source", "channel"] as const) {
    const v = item[key];
    if (typeof v === "string" && v.trim()) return v.trim().slice(0, 64);
  }
  return "";
}

/** 从 feedUrl 里取 host 作为来源名（https://jsonplaceholder.typicode.com/comments → jsonplaceholder.typicode.com） */
export function sourceLabelFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "");
    return host.slice(0, 64);
  } catch {
    return "";
  }
}

/**
 * 推断一批 feed 评论的来源名。
 * 数据集 platform 为「数据源」（URL 定时抓取建的数据集就是这个兜底值）或为空时，
 * 退化为 feedUrl 的 host，避免整批评论来源都显示「数据源」。
 */
export function feedSourceLabel(datasetPlatform: string | null | undefined, feedUrl: string): string {
  const label = (datasetPlatform ?? "").trim();
  if (label && label !== "数据源") return label;
  return sourceLabelFromUrl(feedUrl) || "数据源";
}
