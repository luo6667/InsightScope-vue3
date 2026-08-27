'use client';

import type { DatasetInfo } from "../api/types";
import { Select } from "./ui";

interface Props {
  datasets?: DatasetInfo[];
  datasetId: string;
  onChange: (id: string) => void;
  className?: string;
  /** 是否显示评论数（如 `${name}（1234 条）`）；不需要计数的地方可关闭 */
  showCount?: boolean;
}

/**
 * 数据集选择器：监控台 / 报告 / 告警中心 / 分析 四页共用的数据集下拉。
 * 统一「选择数据集…」占位文案与选项渲染,避免各处重复 map。
 */
export default function DatasetPicker({ datasets, datasetId, onChange, className = "w-56", showCount = true }: Props) {
  return (
    <Select value={datasetId} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">选择数据集…</option>
      {datasets?.map((d) => (
        <option key={d.id} value={d.id}>
          {showCount ? `${d.name}（${d.commentCount} 条）` : d.name}
        </option>
      ))}
    </Select>
  );
}
