import type { EChartsOption } from "echarts";

import type { DatasetStats } from "../../api/types";

/**
 * 舆情图表 option 工厂（DashboardPage 使用）
 *
 * 全部使用运行时 CSS 变量无关的固定深色配色，与 index.css 的 ink/accent 令牌对齐。
 */

export const SENTIMENT = {
  pos: { label: "正面", color: "#34d399", dot: "bg-emerald-400" },
  neu: { label: "中性", color: "#60a5fa", dot: "bg-sky-400" },
  neg: { label: "负面", color: "#f87171", dot: "bg-red-400" },
} as const;

/** 占比文本（0% 兜底，避免除零） */
export function pct(stats: DatasetStats, key: "pos" | "neg"): string {
  return stats.total ? `${Math.round((stats.sentiment[key] / stats.total) * 100)}%` : "0%";
}

export function donutOption(stats: DatasetStats): EChartsOption {
  return {
    tooltip: { trigger: "item", backgroundColor: "#152238", borderWidth: 0, textStyle: { color: "#eef2fa" } },
    legend: { bottom: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: "#a2b2c9", fontSize: 11 } },
    series: [
      {
        type: "pie",
        radius: ["46%", "72%"],
        center: ["50%", "44%"],
        label: { show: false },
        itemStyle: { borderColor: "#101a2b", borderWidth: 2 },
        data: [
          { name: "正面", value: stats.sentiment.pos, itemStyle: { color: SENTIMENT.pos.color } },
          { name: "中性", value: stats.sentiment.neu, itemStyle: { color: SENTIMENT.neu.color } },
          { name: "负面", value: stats.sentiment.neg, itemStyle: { color: SENTIMENT.neg.color } },
        ],
      },
    ],
  };
}

export function compareDonut(stats: DatasetStats): EChartsOption {
  return {
    tooltip: { trigger: "item", backgroundColor: "#152238", borderWidth: 0, textStyle: { color: "#eef2fa" } },
    series: [
      {
        type: "pie",
        radius: ["50%", "75%"],
        label: { color: "#c3cede", fontSize: 11, formatter: "{b} {c}" },
        itemStyle: { borderColor: "#101a2b", borderWidth: 2 },
        data: [
          { name: "正面", value: stats.sentiment.pos, itemStyle: { color: SENTIMENT.pos.color } },
          { name: "中性", value: stats.sentiment.neu, itemStyle: { color: SENTIMENT.neu.color } },
          { name: "负面", value: stats.sentiment.neg, itemStyle: { color: SENTIMENT.neg.color } },
        ],
      },
    ],
  };
}

export function trendOption(stats: DatasetStats): EChartsOption {
  return {
    tooltip: { trigger: "axis", backgroundColor: "#152238", borderWidth: 0, textStyle: { color: "#eef2fa" } },
    legend: { top: 0, itemWidth: 10, itemHeight: 10, textStyle: { color: "#a2b2c9", fontSize: 11 } },
    grid: { left: 36, right: 14, top: 30, bottom: 22 },
    xAxis: {
      type: "category",
      data: stats.trend.map((t) => t.date.slice(5)),
      axisLabel: { color: "#7e8fa9", fontSize: 11 },
      axisLine: { lineStyle: { color: "#2f4063" } },
    },
    yAxis: {
      type: "value",
      axisLabel: { color: "#7e8fa9", fontSize: 11 },
      splitLine: { lineStyle: { color: "#152238" } },
    },
    series: [
      { name: "正面", type: "line", smooth: true, showSymbol: false, data: stats.trend.map((t) => t.pos), lineStyle: { color: SENTIMENT.pos.color, width: 2 }, itemStyle: { color: SENTIMENT.pos.color }, areaStyle: { color: "rgba(52,211,153,0.12)" } },
      { name: "中性", type: "line", smooth: true, showSymbol: false, data: stats.trend.map((t) => t.neu), lineStyle: { color: SENTIMENT.neu.color, width: 2 }, itemStyle: { color: SENTIMENT.neu.color }, areaStyle: { color: "rgba(96,165,250,0.10)" } },
      { name: "负面", type: "line", smooth: true, showSymbol: false, data: stats.trend.map((t) => t.neg), lineStyle: { color: SENTIMENT.neg.color, width: 2 }, itemStyle: { color: SENTIMENT.neg.color }, areaStyle: { color: "rgba(248,113,113,0.14)" } },
    ],
  };
}

export function topicOption(stats: DatasetStats): EChartsOption {
  const top = stats.topics.slice(0, 8).reverse();
  return {
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: "#152238", borderWidth: 0, textStyle: { color: "#eef2fa" } },
    grid: { left: 8, right: 26, top: 6, bottom: 6, containLabel: true },
    xAxis: { type: "value", axisLabel: { color: "#7e8fa9", fontSize: 11 }, splitLine: { lineStyle: { color: "#152238" } } },
    yAxis: {
      type: "category",
      data: top.map((t) => t.name),
      axisLabel: { color: "#c3cede", fontSize: 12 },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        type: "bar",
        data: top.map((t, i) => ({
          value: t.count,
          itemStyle: { color: i >= top.length - 3 ? "#f87171" : "#fbbf24", borderRadius: [0, 4, 4, 0] },
        })),
        barWidth: 14,
      },
    ],
  };
}

export function wordcloudOption(stats: DatasetStats): EChartsOption {
  // 圆形散落词云（评价词典提取的真词），仅水平排布保持可读
  // 颜色按词名稳定 hash，避免每次渲染随机变色抖动
  const colorOf = (name: string) => {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 50;
    return `hsl(${36 + h}, 65%, 62%)`;
  };
  return {
    tooltip: { backgroundColor: "#152238", borderWidth: 0, textStyle: { color: "#eef2fa" } },
    series: [
      {
        type: "wordCloud",
        shape: "circle",
        width: "100%",
        height: "100%",
        sizeRange: [13, 36],
        rotationRange: [0, 0],
        textStyle: {
          fontFamily: "Outfit Variable, system-ui, sans-serif",
          color: (_params: unknown) => colorOf((_params as { name: string }).name),
        },
        data: stats.keywords.map((k) => ({ name: k.word, value: k.count })),
      },
    ],
  };
}
