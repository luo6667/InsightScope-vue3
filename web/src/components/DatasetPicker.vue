<script setup lang="ts">
/**
 * 📘 DatasetPicker.vue —— 取代 src/components/DatasetPicker.tsx
 *
 * 数据集选择器：监控台 / 报告 / 告警中心 / 分析 四页共用的数据集下拉。
 * 统一「选择数据集…」占位文案与选项渲染,避免各处重复 map。
 *
 * React → Vue：ui 的 <Select> + <option> → Element Plus 的 <el-select> / <el-option>
 * （EP 组件由 unplugin-vue-components 自动引入，不写 import）；选项文案、空值项与原版一致。
 * 宽度：EP 的 .el-select 自带 `width: var(--el-select-width)`（=100%）且未包在 @layer 里，
 * 会压过 Tailwind 的 w-56，所以把 className 放在外层 div 上、让 el-select 填满该 div，
 * 这样四个调用页拿到的仍是原来的 14rem 宽度（className prop 字符串未改动）。
 * 对外契约不变：onChange 仍是回调 prop（不是 emit），调用方写
 * `:on-change="setDatasetId"`，与原 React 版 `onChange={setDatasetId}` 一一对应。
 */
import type { DatasetInfo } from '@/api/types'

const props = withDefaults(
  defineProps<{
    datasets?: DatasetInfo[]
    datasetId: string
    onChange: (id: string) => void
    className?: string
    /** 是否显示评论数（如 `${name}（1234 条）`）；不需要计数的地方可关闭 */
    showCount?: boolean
  }>(),
  { datasets: undefined, className: 'w-56', showCount: true },
)

const optionLabel = (d: DatasetInfo) =>
  props.showCount ? `${d.name}（${d.commentCount} 条）` : d.name

// el-select 的 change 直接给出值（不是 DOM event），且项目里 datasetId 是 string
const handleChange = (id: unknown) => props.onChange(String(id ?? ''))
</script>

<template>
  <div :class="props.className">
    <el-select
      :model-value="props.datasetId"
      class="w-full"
      size="default"
      placeholder="选择数据集…"
      @change="handleChange"
    >
      <!-- 等价原 TSX 的 <option value="">选择数据集…</option>：保留「清回空值」的能力 -->
      <el-option label="选择数据集…" value="" />
      <el-option
        v-for="d in props.datasets ?? []"
        :key="d.id"
        :label="optionLabel(d)"
        :value="d.id"
      />
    </el-select>
  </div>
</template>
