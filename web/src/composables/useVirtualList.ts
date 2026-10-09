import type { Ref, ShallowRef } from 'vue'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'

/**
 * 📘 composables/useVirtualList.ts —— 定高/变高列表的窗口裁剪（虚拟滚动）
 *
 * 为什么需要：评论列表可达上千条，全部渲染意味着上千个 DOM 节点 + 上百次重排，
 * 滚动时会掉帧。这里只渲染「可视区 + overscan 缓冲」的那十几项，用 translateY 把
 * 它们摆到正确位置，再用一个 totalHeight 的占位元素撑出真实滚动条高度。
 * 因此 DOM 节点数与数据总量解耦：1 万条与 1 百条的渲染成本一样。
 *
 * 核心算法（与 @tanstack/virtual 同思路，但不引入依赖）：
 * 1. 维护每个 item 的高度前缀和 offsets[]（第 i 项顶部到列表顶部的距离）；
 * 2. 滚动时把 scrollTop 二分查到起始 index（变高场景无法用 i * h 直接算，故一律走二分）；
 * 3. 未测量过的 item 用 itemHeight(index, item) 估算；条目高度已知时无需逐项测量。
 *
 * 性能注意：滚动回调里只读一次 scrollTop / 视口高度（读 clientHeight 会强制同步布局，
 * 所以高度缓存进 viewportHeight，只有窗口 resize 时才重新测量）。
 */

/** 单项位置信息：index 为原数组下标，offset 为该项顶部相对列表顶部的像素距离 */
export interface VirtualItem {
  index: number
  offset: number
}

export interface UseVirtualListOptions<T> {
  /** 数据源（已加载的全部条目） */
  items: Ref<T[]> | ShallowRef<T[]>
  /** 滚动视口元素（该元素自身 overflow-y: auto） */
  viewport: Ref<HTMLElement | null>
  /** 每项高度；传函数则支持按 index / 内容变化的变高列表 */
  itemHeight: number | ((index: number, item: T) => number)
  /** 可视区上下各多渲染几项，防止快速滚动时露白 */
  overscan?: number
}

export function useVirtualList<T>(options: UseVirtualListOptions<T>) {
  const { items, viewport, itemHeight } = options
  const overscan = options.overscan ?? 6

  const heights = shallowRef<number[]>([])
  const offsets = shallowRef<number[]>([])
  const scrollTop = ref(0)
  const viewportHeight = ref(0)
  /**
   * 变更计数器：offsets / heights 用的是 shallowRef（避免上千个数字走深响应式），
   * 但 shallowRef 在「原地修改数组」时不会触发依赖更新，所以每次重建都自增这个
   * 计数器，让下游 computed 显式依赖它 —— 这比把整个数组换成新引用便宜得多。
   */
  const revision = ref(0)

  const sizeOf = (index: number, item: T) =>
    typeof itemHeight === 'function' ? Math.max(1, itemHeight(index, item)) : itemHeight

  /** 重建前缀和 + 总高（数据变化、视口 resize 后调用） */
  function rebuild() {
    const list = items.value ?? []
    const nextHeights = new Array<number>(list.length)
    const nextOffsets = new Array<number>(list.length)
    let total = 0
    for (let i = 0; i < list.length; i += 1) {
      nextOffsets[i] = total
      const h = sizeOf(i, list[i] as T)
      nextHeights[i] = h
      total += h
    }
    heights.value = nextHeights
    offsets.value = nextOffsets
    revision.value += 1
  }

  // 数据变化（新一页到达 / 筛选后重建数组）→ 重建前缀和。
  // 同时监听 length：父级原地 push（不换数组引用）时也要能感知。
  watch(
    [items, () => items.value?.length ?? 0],
    () => rebuild(),
    { immediate: true },
  )

  function measure() {
    const el = viewport.value
    if (!el) return
    viewportHeight.value = el.clientHeight
    scrollTop.value = el.scrollTop
    rebuild()
  }

  // 视口元素挂载后测量一次真实高度（模板 ref 在 setup 阶段还是 null）
  watch(viewport, () => measure(), { immediate: true })

  // 浏览器窗口尺寸变化会改变视口高度 → 重新裁剪 + 重建（行高可能依赖宽度）
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', measure)
    onBeforeUnmount(() => window.removeEventListener('resize', measure))
  }

  /** 二分查找：offsets 中最后一个 <= target 的下标（变高列表无法用 target / h 直接算） */
  function findStart(target: number): number {
    const off = offsets.value
    let lo = 0
    let hi = off.length - 1
    let ans = 0
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if ((off[mid] as number) <= target) {
        ans = mid
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return ans
  }

  const totalHeight = computed(() => {
    revision.value
    const off = offsets.value
    const hs = heights.value
    return off.length ? (off[off.length - 1] as number) + (hs[hs.length - 1] as number) : 0
  })

  const virtualItems = computed<VirtualItem[]>(() => {
    revision.value
    const off = offsets.value
    if (!off.length) return []

    const start = Math.max(0, findStart(scrollTop.value) - overscan)
    // 可视区底部对应的像素位置：多留一屏用于 overscan 缓冲
    const limit = scrollTop.value + Math.max(viewportHeight.value, 1)
    const end = findStart(limit)

    const out: VirtualItem[] = []
    for (let i = start; i < off.length && i <= end + overscan; i += 1) {
      out.push({ index: i, offset: off[i] as number })
    }
    return out
  })

  /** 当前条目总数（父级用它配合渲染窗口判断是否接近列表尾部） */
  const totalItems = computed(() => items.value?.length ?? 0)

  function onScroll() {
    const el = viewport.value
    if (!el) return
    scrollTop.value = el.scrollTop
  }

  /** 回到顶部（切换数据集 / 改筛选条件时调用） */
  function scrollToTop() {
    const el = viewport.value
    if (!el) return
    el.scrollTop = 0
    scrollTop.value = 0
  }

  return {
    virtualItems,
    totalHeight,
    totalItems,
    onScroll,
    scrollToTop,
    /** 数据变更后手动重建（例如外部直接改了 item 字段但没换数组引用） */
    rebuild,
  }
}
