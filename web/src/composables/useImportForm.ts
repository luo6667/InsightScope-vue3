import { ref } from 'vue'
import { toast } from 'vue-sonner'

import { errMsg } from '@/lib/errors'

/**
 * 📘 composables/useImportForm.ts —— 取代旧 hooks/useImportForm.ts
 *
 * 导入表单统一状态机（PasteImport / CsvImport / FeedImport 共用）：
 * - loading + error 两个状态；
 * - run()：执行异步导入，成功 toast 并回调 onDone（跳转），失败展示错误；
 * - fail()：校验失败时直接展示错误信息。
 * 替代三个表单各自重复的 loading/error/submit 实现（sonner → vue-sonner）。
 */
export interface ImportResult {
  id: string
  count: number
}

export function useImportForm() {
  const loading = ref(false)
  const error = ref<string | null>(null)

  const fail = (message: string | null) => {
    error.value = message
  }

  const run = async (
    action: () => Promise<ImportResult>,
    success: (r: ImportResult) => string,
    onDone: (id: string) => void,
  ): Promise<void> => {
    loading.value = true
    error.value = null
    try {
      const r = await action()
      toast.success(success(r))
      onDone(r.id)
    } catch (e) {
      error.value = errMsg(e)
    } finally {
      loading.value = false
    }
  }

  return { loading, error, fail, run }
}
