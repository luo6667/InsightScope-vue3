import type { EChartsOption } from "echarts";
import { Activity, Info, MessageSquareText, Radar, Scale, Tags, X } from "lucide-react";

import type { DatasetStats } from "../../api/types";
import EChart from "../EChart";
import { Card, CardHeader, Skeleton } from "../ui";
import NotAnalyzed from "./NotAnalyzed";
import { compareDonut } from "./options";
import RangeField from "./RangeField";

export interface ChartOptions {
  donut: EChartsOption;
  trend: EChartsOption;
  topic: EChartsOption;
  wordcloud: EChartsOption;
}

export interface RangeValue {
  from: string;
  to: string;
}

interface Props {
  stats?: DatasetStats;
  chartOptions: ChartOptions | null;
  topicFilter: string | null;
  onTopicFilterChange: (t: string | null) => void;
  rangeA: RangeValue;
  rangeB: RangeValue;
  onRangeAChange: (r: RangeValue) => void;
  onRangeBChange: (r: RangeValue) => void;
  statsA?: DatasetStats;
  statsB?: DatasetStats;
}

/** 图表区：情感分布 / 趋势 / 主题 / 词云四图 + 时段对比;未分析时提示,无数据时骨架屏 */
export default function ChartGrid({
  stats,
  chartOptions,
  topicFilter,
  onTopicFilterChange,
  rangeA,
  rangeB,
  onRangeAChange,
  onRangeBChange,
  statsA,
  statsB,
}: Props) {
  if (!stats || !chartOptions) {
    return (
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <Skeleton className="h-52 w-full" />
        </Card>
        <Card className="p-4">
          <Skeleton className="h-52 w-full" />
        </Card>
      </div>
    );
  }

  return (
    <div className="mt-4">
      {stats.analyzed === 0 && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-800/40 bg-amber-950/20 px-3.5 py-2.5 text-[13px] text-amber-300">
          <Info size={14} className="shrink-0" />
          该数据集尚未分析（{stats.total} 条评论待处理），去「智能分析」开始后情感 / 趋势 / 主题将出现数据
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader icon={<Radar size={15} />} title="情感分布" />
          <div className="p-3">
            {stats.analyzed === 0 ? (
              <NotAnalyzed h="h-56" />
            ) : (
              <EChart option={chartOptions.donut} className="h-56" />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader icon={<Activity size={15} />} title="评论趋势（按天）" />
          <div className="p-3">
            {stats.analyzed === 0 ? (
              <NotAnalyzed h="h-56" />
            ) : (
              <EChart option={chartOptions.trend} className="h-56" />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader
            icon={<Tags size={15} />}
            title="热门主题"
            extra={
              topicFilter && (
                <span className="flex items-center gap-1 text-xs text-accent-400">
                  {topicFilter}
                  <button onClick={() => onTopicFilterChange(null)} className="hover:text-ink-100">
                    <X size={12} />
                  </button>
                </span>
              )
            }
          />
          <div className="p-3">
            {stats.analyzed === 0 ? (
              <NotAnalyzed h="h-52" />
            ) : (
              <EChart
                option={chartOptions.topic}
                className="h-52"
                onEvents={{
                  click: (p: unknown) => {
                    const name = (p as { name?: string })?.name;
                    if (name) onTopicFilterChange(name);
                  },
                }}
              />
            )}
          </div>
        </Card>
        <Card>
          <CardHeader icon={<MessageSquareText size={15} />} title="关键词云（内容词频）" />
          <div className="p-3">
            <EChart option={chartOptions.wordcloud} className="h-52" />
          </div>
        </Card>
      </div>

      {/* 时段对比 */}
      <Card className="mt-4">
        <CardHeader icon={<Scale size={15} />} title="时段对比" extra={<span className="text-xs text-ink-400">两个时间段的评论情况对比</span>} />
        <div className="p-4">
          <div className="flex flex-wrap items-end gap-4">
            <RangeField label="时段 A" range={rangeA} onChange={onRangeAChange} />
            <RangeField label="时段 B" range={rangeB} onChange={onRangeBChange} />
          </div>
          {statsA && statsB && (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="rounded-xl border border-ink-800 bg-ink-950 p-3">
                <div className="mb-2 text-xs font-medium text-ink-300">
                  {rangeA.from} ~ {rangeA.to}（{statsA.total} 条）
                </div>
                <EChart option={compareDonut(statsA)} className="h-40" />
              </div>
              <div className="rounded-xl border border-ink-800 bg-ink-950 p-3">
                <div className="mb-2 text-xs font-medium text-ink-300">
                  {rangeB.from} ~ {rangeB.to}（{statsB.total} 条）
                </div>
                <EChart option={compareDonut(statsB)} className="h-40" />
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
