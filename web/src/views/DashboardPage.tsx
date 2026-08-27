import { useQueryClient } from "@tanstack/react-query";
import { Radar } from "lucide-react";
import { useEffect, useState } from "react";

import { setSimSpeed, startSimulate, stopSimulate } from "../api/api";
import type { Alert, CommentRow } from "../api/types";
import CommentModal from "../components/CommentModal";
import ChartGrid from "../components/dashboard/ChartGrid";
import LiveMonitor from "../components/dashboard/LiveMonitor";
import { donutOption, topicOption, trendOption, wordcloudOption } from "../components/dashboard/options";
import OverviewStats from "../components/dashboard/OverviewStats";
import RecentComments from "../components/dashboard/RecentComments";
import DatasetPicker from "../components/DatasetPicker";
import { EmptyState, PageHeader } from "../components/ui";
import { useCurrentDataset } from "../hooks/useCurrentDataset";
import { useComments, useDatasets, useDatasetStats } from "../hooks/useData";
import { useDatasetSocket } from "../hooks/useDatasetSocket";
import { customDictKey } from "../lib/customDict";
import { errMsg } from "../lib/errors";

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * 舆情监控台：概览统计 / 实时监控 / 四图图表区 / 最近评论。
 * 状态与 socket 订阅集中在父组件,渲染拆分为 OverviewStats / LiveMonitor /
 * ChartGrid / RecentComments(见 components/dashboard/)。
 */
export default function DashboardPage() {
  const qc = useQueryClient();
  const { datasetId, setDatasetId } = useCurrentDataset();

  const { data: datasets } = useDatasets();
  // 自定义词典：加入词云统计（localStorage，设置页配置）
  const dictKey = customDictKey();
  const dictParam = dictKey ? { dictionary: dictKey } : undefined;

  const { data: stats } = useDatasetStats(datasetId, dictParam);
  // 主题钻取：点击主题图后按主题筛选评论
  const [topicFilter, setTopicFilter] = useState<string | null>(null);
  const { data: commentsRes } = useComments(datasetId, { limit: 8, topic: topicFilter ?? undefined });

  // 时段对比：最近 7 天 vs 前 7 天
  const [rangeA, setRangeA] = useState({ from: daysAgo(7), to: daysAgo(0) });
  const [rangeB, setRangeB] = useState({ from: daysAgo(14), to: daysAgo(8) });
  const { data: statsA } = useDatasetStats(datasetId, {
    from: `${rangeA.from}T00:00:00`,
    to: `${rangeA.to}T23:59:59`,
    ...dictParam,
  });
  const { data: statsB } = useDatasetStats(datasetId, {
    from: `${rangeB.from}T00:00:00`,
    to: `${rangeB.to}T23:59:59`,
    ...dictParam,
  });

  // 评论详情弹窗
  const [selectedComment, setSelectedComment] = useState<CommentRow | null>(null);

  // 实时监控状态
  const [liveComments, setLiveComments] = useState<CommentRow[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [simRunning, setSimRunning] = useState(false);
  const [speed, setSpeed] = useState(5);
  const [simError, setSimError] = useState<string | null>(null);
  const [inflow, setInflow] = useState(0);
  const [windowSentiments, setWindowSentiments] = useState<CommentRow["sentiment"][]>([]);

  const windowNegRate = windowSentiments.length
    ? Math.round((windowSentiments.filter((s) => s === "neg").length / windowSentiments.length) * 100)
    : 0;

  // 切换数据集时重置实时状态 + 停止旧模拟器
  useEffect(() => {
    setLiveComments([]);
    setAlerts([]);
    setInflow(0);
    setWindowSentiments([]);
    setSimError(null);
    setTopicFilter(null);
    return () => {
      // 切走时停止该数据集的模拟器（重新播放从头开始）；无数据集时跳过空 id 请求
      if (!datasetId) return;
      void stopSimulate(datasetId).catch(() => {});
    };
  }, [datasetId]);

  // socket 订阅：实时评论 / 告警（含浏览器通知）/ 模拟状态
  useDatasetSocket(datasetId, {
    "comment:stream": (payload) => {
      const c = payload as CommentRow;
      setLiveComments((prev) => [c, ...prev].slice(0, 6));
      setInflow((n) => n + 1);
      setWindowSentiments((prev) => [...prev, c.sentiment].slice(-20));
    },
    "alert:new": (payload) => {
      const a = payload as Alert;
      setAlerts((prev) => [a, ...prev].slice(0, 3));
      if ("Notification" in window) {
        if (Notification.permission === "granted") {
          new Notification(`舆情告警${a.severity === "critical" ? "（严重）" : ""}`, { body: a.message });
        } else if (Notification.permission === "default") {
          void Notification.requestPermission();
        }
      }
    },
    "sim:status": (payload) => setSimRunning((payload as { running: boolean }).running),
  });

  const changeSpeed = async (v: number) => {
    setSpeed(v);
    if (simRunning) {
      try {
        await setSimSpeed(datasetId, v);
      } catch {
        /* 忽略 */
      }
    }
  };

  const toggleSim = async () => {
    setSimError(null);
    try {
      if (simRunning) {
        await stopSimulate(datasetId);
        setSimRunning(false);
      } else {
        const r = await startSimulate(datasetId, speed);
        setSimRunning(true);
        setSpeed(r.speed);
      }
    } catch (e) {
      setSimError(errMsg(e));
    }
  };

  const current = datasets?.find((d) => d.id === datasetId);

  // 图表 option（React Compiler 自动记忆化，stats 不变时引用稳定，避免实时流入重渲染触发全图重绘）
  const chartOptions = (() => {
    if (!stats) return null;
    return {
      donut: donutOption(stats),
      trend: trendOption(stats),
      topic: topicOption(stats),
      wordcloud: wordcloudOption(stats),
    };
  })();

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <PageHeader
        title="舆情监控台"
        desc="情感、主题与实时舆情走势一览"
        extra={<DatasetPicker datasets={datasets} datasetId={datasetId} onChange={setDatasetId} />}
      />

      {!datasetId && (
        <div className="mt-8">
          <EmptyState
            icon={<Radar size={28} strokeWidth={1.6} />}
            title="选择数据集开始监控"
            desc="从右上角选择一个数据集，或先到「导入数据」创建内置场景"
          />
        </div>
      )}

      {datasetId && current && (
        <>
          <OverviewStats stats={stats} current={current} />
          <LiveMonitor
            simRunning={simRunning}
            speed={speed}
            onSpeedChange={(v) => void changeSpeed(v)}
            onToggleSim={() => void toggleSim()}
            simError={simError}
            inflow={inflow}
            windowNegRate={windowNegRate}
            alerts={alerts}
            onDismissAlert={(id) => setAlerts((prev) => prev.filter((x) => x.id !== id))}
            liveComments={liveComments}
          />
          <ChartGrid
            stats={stats}
            chartOptions={chartOptions}
            topicFilter={topicFilter}
            onTopicFilterChange={setTopicFilter}
            rangeA={rangeA}
            rangeB={rangeB}
            onRangeAChange={setRangeA}
            onRangeBChange={setRangeB}
            statsA={statsA}
            statsB={statsB}
          />
          <RecentComments
            comments={commentsRes?.comments}
            topicFilter={topicFilter}
            onTopicFilterChange={setTopicFilter}
            onSelect={setSelectedComment}
          />
        </>
      )}

      <CommentModal
        key={selectedComment?.id ?? "closed"}
        datasetId={datasetId}
        comment={selectedComment}
        onClose={() => setSelectedComment(null)}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["comments", datasetId] });
          qc.invalidateQueries({ queryKey: ["stats", datasetId] });
        }}
      />
    </div>
  );
}
