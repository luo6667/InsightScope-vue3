import { useState } from "react";
import { toast } from "sonner";

import { errMsg } from "../lib/errors";

export interface ImportResult {
  id: string;
  count: number;
}

/**
 * 导入表单统一状态机(PasteImport / CsvImport / FeedImport 共用):
 * - loading + error 两个状态;
 * - run():执行异步导入,成功 toast 并回调 onDone(跳转),失败展示错误;
 * - fail():校验失败时直接展示错误信息。
 * 替代三个表单各自重复的 loading/error/submit 实现。
 */
export function useImportForm() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (
    action: () => Promise<ImportResult>,
    success: (r: ImportResult) => string,
    onDone: (id: string) => void
  ): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const r = await action();
      toast.success(success(r));
      onDone(r.id);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  return { loading, error, fail: setError, run };
}
