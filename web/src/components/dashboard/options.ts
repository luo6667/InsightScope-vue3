import type { EChartsOption } from 'echarts'

import type { DatasetStats } from '../../api/types'

/**
 * 舆情图表 option 工厂（监控台使用）
 *
 * ECharts 画在 canvas 上，拿不到 CSS 变量，因此这里按主题提供两套调色板：
 * 取值与 index.css 的 ink/accent 令牌一一对应（注释里标注了对应令牌），
 * 调用方（DashboardView / ChartGrid）在主题切换时用新的 palette 重算 option 即可。
 */

export type ChartTheme = 'dark' | 'light'

export interface ChartPalette {
  /** tooltip 背景 / 文字 / 边框（深色无需边框） */
  tooltipBg: string
  tooltipText: string
  tooltipBorder: string
  tooltipBorderWidth: number
  /** 图例文字 */
  legendText: string
  /** 坐标轴标签 */
  axisLabel: string
  /** 坐标轴线 */
  axisLine: string
  /** 网格分割线 */
  splitLine: string
  /** 环形图扇区描边（等于卡片背景色） */
  donutBorder: string
  /** 高对比正文色（占比标签、类目轴标签） */
  strongText: string
  /** 情绪三色与趋势面积填充 */
  pos: string
  neu: string
  neg: string
  posArea: string
  neuArea: string
  negArea: string
  /** 主题条形（热门主题）与其高亮（后三名） */
  bar: string
  barHighlight: string
  /** 词云 hsl 亮度百分比（深色底需要更亮，浅色底需要更暗） */
  wordcloudLightness: number
}

export const CHART_PALETTES: Record<ChartTheme, ChartPalette> = {
  dark: {
    tooltipBg: '#152238', // ink-850
    tooltipText: '#eef2fa', // ink-100
    tooltipBorder: 'transparent',
    tooltipBorderWidth: 0,
    legendText: '#a2b2c9', // ink-400
    axisLabel: '#7e8fa9', // ink-500
    axisLine: '#2f4063', // ink-700
    splitLine: '#152238', // ink-850
    donutBorder: '#101a2b', // ink-900
    strongText: '#c3cede', // ink-300
    pos: '#34d399',
    neu: '#60a5fa',
    neg: '#f87171',
    posArea: 'rgba(52,211,153,0.12)',
    neuArea: 'rgba(96,165,250,0.10)',
    negArea: 'rgba(248,113,113,0.14)',
    bar: '#fbbf24', // accent-400
    barHighlight: '#f87171',
    wordcloudLightness: 62,
  },
  light: {
    tooltipBg: '#ffffff', // ink-900
    tooltipText: '#0f172a', // ink-100
    tooltipBorder: '#e1e6ef', // ink-800
    tooltipBorderWidth: 1,
    legendText: '#475569', // ink-400
    axisLabel: '#64748b', // ink-500
    axisLine: '#c5cddb', // ink-700
    splitLine: '#e1e6ef', // ink-800
    donutBorder: '#ffffff', // ink-900
    strongText: '#334155', // ink-300
    pos: '#10b981',
    neu: '#3b82f6',
    neg: '#ef4444',
    posArea: 'rgba(16,185,129,0.14)',
    neuArea: 'rgba(59,130,246,0.12)',
    negArea: 'rgba(239,68,68,0.14)',
    bar: '#d97706', // accent-500
    barHighlight: '#ef4444',
    wordcloudLightness: 45,
  },
}

export const SENTIMENT = {
  pos: { label: '正面', color: '#34d399', dot: 'bg-emerald-400' },
  neu: { label: '中性', color: '#60a5fa', dot: 'bg-sky-400' },
  neg: { label: '负面', color: '#f87171', dot: 'bg-red-400' },
} as const

function tooltip(palette: ChartPalette, trigger: 'item' | 'axis') {
  return {
    trigger,
    backgroundColor: palette.tooltipBg,
    borderColor: palette.tooltipBorder,
    borderWidth: palette.tooltipBorderWidth,
    textStyle: { color: palette.tooltipText },
  }
}

/** 占比文本（0% 兜底，避免除零） */
export function pct(stats: DatasetStats, key: 'pos' | 'neg'): string {
  return stats.total ? `${Math.round((stats.sentiment[key] / stats.total) * 100)}%` : '0%'
}

export function donutOption(stats: DatasetStats, palette: ChartPalette): EChartsOption {
  return {
    tooltip: tooltip(palette, 'item'),
    legend: {
      bottom: 0,
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: palette.legendText, fontSize: 11 },
    },
    series: [
      {
        type: 'pie',
        radius: ['46%', '72%'],
        center: ['50%', '44%'],
        label: { show: false },
        itemStyle: { borderColor: palette.donutBorder, borderWidth: 2 },
        data: [
          { name: '正面', value: stats.sentiment.pos, itemStyle: { color: palette.pos } },
          { name: '中性', value: stats.sentiment.neu, itemStyle: { color: palette.neu } },
          { name: '负面', value: stats.sentiment.neg, itemStyle: { color: palette.neg } },
        ],
      },
    ],
  }
}

export function compareDonut(stats: DatasetStats, palette: ChartPalette): EChartsOption {
  return {
    tooltip: tooltip(palette, 'item'),
    series: [
      {
        type: 'pie',
        radius: ['50%', '75%'],
        label: { color: palette.strongText, fontSize: 11, formatter: '{b} {c}' },
        itemStyle: { borderColor: palette.donutBorder, borderWidth: 2 },
        data: [
          { name: '正面', value: stats.sentiment.pos, itemStyle: { color: palette.pos } },
          { name: '中性', value: stats.sentiment.neu, itemStyle: { color: palette.neu } },
          { name: '负面', value: stats.sentiment.neg, itemStyle: { color: palette.neg } },
        ],
      },
    ],
  }
}

export function trendOption(stats: DatasetStats, palette: ChartPalette): EChartsOption {
  return {
    tooltip: tooltip(palette, 'axis'),
    legend: {
      top: 0,
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: palette.legendText, fontSize: 11 },
    },
    grid: { left: 36, right: 14, top: 30, bottom: 22 },
    xAxis: {
      type: 'category',
      data: stats.trend.map((t) => t.date.slice(5)),
      axisLabel: { color: palette.axisLabel, fontSize: 11 },
      axisLine: { lineStyle: { color: palette.axisLine } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: palette.axisLabel, fontSize: 11 },
      splitLine: { lineStyle: { color: palette.splitLine } },
    },
    series: [
      {
        name: '正面',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: stats.trend.map((t) => t.pos),
        lineStyle: { color: palette.pos, width: 2 },
        itemStyle: { color: palette.pos },
        areaStyle: { color: palette.posArea },
      },
      {
        name: '中性',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: stats.trend.map((t) => t.neu),
        lineStyle: { color: palette.neu, width: 2 },
        itemStyle: { color: palette.neu },
        areaStyle: { color: palette.neuArea },
      },
      {
        name: '负面',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: stats.trend.map((t) => t.neg),
        lineStyle: { color: palette.neg, width: 2 },
        itemStyle: { color: palette.neg },
        areaStyle: { color: palette.negArea },
      },
    ],
  }
}

export function topicOption(stats: DatasetStats, palette: ChartPalette): EChartsOption {
  const top = stats.topics.slice(0, 8).reverse()
  return {
    tooltip: { ...tooltip(palette, 'axis'), axisPointer: { type: 'shadow' } },
    grid: { left: 8, right: 26, top: 6, bottom: 6, containLabel: true },
    xAxis: {
      type: 'value',
      axisLabel: { color: palette.axisLabel, fontSize: 11 },
      splitLine: { lineStyle: { color: palette.splitLine } },
    },
    yAxis: {
      type: 'category',
      data: top.map((t) => t.name),
      axisLabel: { color: palette.strongText, fontSize: 12 },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        type: 'bar',
        data: top.map((t, i) => ({
          value: t.count,
          itemStyle: {
            color: i >= top.length - 3 ? palette.barHighlight : palette.bar,
            borderRadius: [0, 4, 4, 0],
          },
        })),
        barWidth: 14,
      },
    ],
  }
}

export function wordcloudOption(stats: DatasetStats, palette: ChartPalette): EChartsOption {
  // 圆形散落词云（评价词典提取的真词），仅水平排布保持可读
  // 颜色按词名稳定 hash，避免每次渲染随机变色抖动
  const colorOf = (name: string) => {
    let h = 0
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 50
    return `hsl(${36 + h}, 65%, ${palette.wordcloudLightness}%)`
  }
  return {
    tooltip: tooltip(palette, 'item'),
    series: [
      {
        type: 'wordCloud',
        shape: 'circle',
        width: '100%',
        height: '100%',
        sizeRange: [13, 36],
        rotationRange: [0, 0],
        textStyle: {
          fontFamily: 'Outfit Variable, system-ui, sans-serif',
          color: (_params: unknown) => colorOf((_params as { name: string }).name),
        },
        data: stats.keywords.map((k) => ({ name: k.word, value: k.count })),
      },
    ],
  }
}
