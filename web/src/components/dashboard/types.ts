import type { EChartsOption } from 'echarts'

/**
 * 📘 components/dashboard/types.ts —— 监控台图表的共享类型
 *
 * 原先 RangeValue 在 DashboardView.vue 与 ChartGrid.vue 各声明一份，
 * ChartOptions 只存在于 ChartGrid.vue；抽到这里让父子组件共用同一份定义。
 */

/** 监控台四张图的 option 集合（DashboardView 生成 → ChartGrid 渲染） */
export interface ChartOptions {
  donut: EChartsOption
  trend: EChartsOption
  topic: EChartsOption
  wordcloud: EChartsOption
}

/** 时段对比里的一个时间范围（日期字符串 yyyy-MM-dd，闭区间） */
export interface RangeValue {
  from: string
  to: string
}
