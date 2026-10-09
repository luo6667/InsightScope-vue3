<script setup lang="ts" generic="T extends { id: string }">
/**
 * 📘 VirtualList.vue —— 通用虚拟滚动列表
 *
 * 只渲染「可视区 + overscan」的少数几项，用一个撑满 totalHeight 的占位撑出滚动条，
 * 所以 DOM 节点数与数据总量解耦（1000 条与 100 条的渲染成本相同）。
 *
 * 结构（避开「滚动容器既是定位父级又要裁剪」的坑）：
 *   .overflow-y-auto（滚动视口，position: relative）
 *     └ .relative + height=totalHeight（只负责撑高，内容不在这里）
 *         └ .absolute inset-x-0 top-0 + translateY(第 i 项的 offset)（真正渲染的每一项）
 *
 * 为什么用 translateY 而不是 top：transform 只触发合成层重绘，不参与布局计算；
 * 每帧改 top 会让浏览器对整段列表做重排。
 *
 * 算法与「当前该渲染哪几项」由 composables/useVirtualList.ts 负责，本组件只管渲染与事件。
 *
 * Vue 语义说明：useVirtualList 返回的是「含 ref 的普通对象」，普通对象的属性**不会**在
 * 模板里自动解包，所以这里把 ref 逐个解构到顶层绑定（顶层 ref 才自动解包），
 * 避免模板里到处写 .value。
 */
import { computed, ref, shallowRef, watch } from 'vue'

import { useVirtualList } from '@/composables/useVirtualList'

const props = withDefaults(
  defineProps<{
    items: T[]
    /** 每项高度（定高列表直接给数字；变高列表给函数） */
    itemHeight: number | ((index: number, item: T) => number)
    /** 可视区上下各多渲染几项，防止快速滚动时露白 */
    overscan?: number
    /** 视口高度（px）；不传则按容器实际高度自适应 */
    height?: number
  }>(),
  { overscan: 6, height: undefined },
)

const emit = defineEmits<{
  select: [item: T]
  /**
   * 可视窗口变化（首帧、滚动、数据增长都会触发）。
   * 父级据此判断「是否快滚到底部」来预取下一页 —— 比 IntersectionObserver 更可靠：
   * 观察器只在相交状态**发生变化**时回调，一旦哨兵元素因条件渲染而晚于挂载出现，
   * 就再也没有机会被 observe，预取会永久停在第二页。
   */
  range: [payload: { start: number; end: number; total: number }]
}>()

const viewportEl = ref<HTMLElement | null>(null)
const itemsRef = shallowRef<T[]>(props.items)

// props.items 每次重建都是新引用；同步进本地 shallowRef（浅引用即足以触发重建，
// 无需 deep 响应式——上千条数据用 reactive 会带来无谓的代理开销）
watch(
  () => props.items,
  (v) => {
    itemsRef.value = v
  },
  { immediate: true },
)

const { virtualItems, totalHeight, totalItems, onScroll, scrollToTop } = useVirtualList({
  items: itemsRef,
  viewport: viewportEl,
  itemHeight: props.itemHeight,
  overscan: props.overscan,
})

// 把「当前渲染的是哪一段下标」抛给父级：预取判定无需任何 DOM 观察器
watch(virtualItems, (list) => {
  const first = list[0]
  const last = list[list.length - 1]
  if (!first || !last) return
  emit('range', { start: first.index, end: last.index, total: totalItems.value })
})

const viewportStyle = computed(() =>
  props.height ? { height: `${props.height}px` } : undefined,
)

/** 第 i 项的高度：定高直接用；变高用相邻 offset 差值，最后一项用 total 补 */
function sizeOf(index: number): number {
  if (typeof props.itemHeight === 'number') return props.itemHeight
  const off = virtualItems.value
  const pos = off.findIndex((v) => v.index === index)
  if (pos >= 0 && pos + 1 < off.length) return off[pos + 1]!.offset - off[pos]!.offset
  return props.itemHeight(index, props.items[index]!)
}

// 对父级暴露的是「取值函数」而不是 computed ref：父级通过模板 ref 拿到的是本组件的
// 代理对象，上面挂的 ref 不会被自动解包，暴露函数能避免父级还要写 .value。
defineExpose({
  scrollToTop,
})
</script>

<template>
  <div
    ref="viewportEl"
    class="relative overflow-y-auto overscroll-contain"
    :style="viewportStyle"
    @scroll.passive="onScroll"
  >
    <div class="relative w-full" :style="{ height: `${totalHeight}px` }">
      <div
        v-for="v in virtualItems"
        :key="items[v.index]!.id"
        class="absolute inset-x-0 top-0"
        :style="{ transform: `translateY(${v.offset}px)`, height: `${sizeOf(v.index)}px` }"
        @click="emit('select', items[v.index]!)"
      >
        <slot :item="items[v.index]!" :index="v.index" />
      </div>
    </div>
  </div>
</template>
