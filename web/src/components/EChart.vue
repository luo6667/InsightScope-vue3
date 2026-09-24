<script setup lang="ts">
/**
 * 📘 EChart.vue —— 取代 src/components/EChart.tsx
 *
 * ECharts 的 Vue 封装：init / resize / setOption / dispose 与 React 版逐条对应。
 * 差异：className → class 透传（inheritAttrs:false + useAttrs，没传 class 时兜底 h-64）；
 * onEvents 仍是 props（不是 emit），保持 React 版 `:on-events="{ click: fn }"` 的调用方式。
 */
import type { EChartsOption } from 'echarts'
import { computed, onMounted, onUnmounted, useAttrs, useTemplateRef, watch } from 'vue'

import echarts from '@/lib/echarts'

const props = defineProps<{
  option: EChartsOption
  onEvents?: Record<string, (params: unknown) => void>
}>()

// class 由模板单独处理，其余 attrs 原样透传到根 div
defineOptions({ inheritAttrs: false })

const el = useTemplateRef<HTMLDivElement>('el')
const attrs = useAttrs()

const rest = computed(() => {
  const { class: _cls, ...r } = attrs
  return r
})

let chart: echarts.ECharts | null = null
let boundEvents: string[] = []

const onResize = () => chart?.resize()

/** 先解绑旧事件名，再按新表重新绑定（等价 React effect 的 cleanup + 重新 on） */
const bindEvents = () => {
  if (!chart) return
  for (const name of boundEvents) chart.off(name)
  boundEvents = props.onEvents ? Object.keys(props.onEvents) : []
  if (!props.onEvents) return
  for (const [name, fn] of Object.entries(props.onEvents)) chart.on(name, fn)
}

onMounted(() => {
  const dom = el.value
  if (!dom) return
  chart = echarts.init(dom)
  window.addEventListener('resize', onResize)
  chart.setOption(props.option, true)
  bindEvents() // 首屏绑定一次（watch 不带 immediate，静态 onEvents 只走这里）
})

onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  chart?.dispose()
  chart = null
  boundEvents = []
})

// 等价 React 的 useEffect(..., [option])：true = notMerge
watch(
  () => props.option,
  (o) => chart?.setOption(o, true),
  { deep: true },
)

// 等价 React 的 useEffect(..., [onEvents])
watch(() => props.onEvents, bindEvents, { deep: true })
</script>

<template>
  <div ref="el" v-bind="rest" :class="(attrs.class as string) || 'h-64'" />
</template>
