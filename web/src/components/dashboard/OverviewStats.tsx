import type { DatasetInfo, DatasetStats } from "../../api/types";
import { Card, Skeleton, StatCard } from "../ui";
import { pct } from "./options";

interface Props {
  stats?: DatasetStats;
  current?: DatasetInfo;
}

/** 概览统计卡：评论总数 / 已分析 / 正负面占比;数据未就绪时显示骨架屏 */
export default function OverviewStats({ stats, current }: Props) {
  if (!stats || !current) {
    return (
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-4">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="mt-2 h-7 w-2/3" />
          </Card>
        ))}
      </div>
    );
  }
  return (
    <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard label="评论总数" value={stats.total} sub={current.platform} />
      <StatCard
        label="已分析"
        value={stats.analyzed}
        sub={`${stats.total ? Math.round((stats.analyzed / stats.total) * 100) : 0}% 覆盖率`}
      />
      <StatCard label="正面占比" value={`${pct(stats, "pos")}`} sub={`${stats.sentiment.pos} 条`} accentCls="text-emerald-400" />
      <StatCard label="负面占比" value={`${pct(stats, "neg")}`} sub={`${stats.sentiment.neg} 条`} accentCls="text-red-400" />
    </div>
  );
}
