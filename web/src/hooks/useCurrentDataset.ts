import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

import { useWorkspace } from "../store/workspace";

/**
 * 统一的"当前数据集"选择状态：
 * - URL ?dataset= 优先（从数据集页跳转带参）
 * - 否则用全局 store（跨页面保持）
 * - 选择器变更时同步 URL + store（保留其他查询参数）
 */
export function useCurrentDataset(): { datasetId: string; setDatasetId: (id: string) => void } {
  const params = useSearchParams();
  const router = useRouter();
  const urlDs = params.get("dataset") ?? "";
  const storeDs = useWorkspace((s) => s.datasetId);
  const setStoreDs = useWorkspace((s) => s.setDatasetId);

  // URL 带参（跳转）时同步进 store
  useEffect(() => {
    if (urlDs && urlDs !== storeDs) setStoreDs(urlDs);
  }, [urlDs, storeDs, setStoreDs]);

  const datasetId = urlDs || storeDs;

  const setDatasetId = (id: string) => {
    setStoreDs(id);
    // 同步 URL ?dataset=（保留其他查询参数）
    const next = new URLSearchParams(params.toString());
    if (id) next.set("dataset", id);
    else next.delete("dataset");
    const qs = next.toString();
    router.replace(qs ? `?${qs}` : window.location.pathname, { scroll: false });
  };

  return { datasetId, setDatasetId };
}
