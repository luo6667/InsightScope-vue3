import { Activity, Bell, Pause, Play, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import type { Alert, CommentRow } from "../../api/types";
import { Badge, Button, Card, CardHeader, Select } from "../ui";
import { SENTIMENT } from "./options";

interface Props {
  simRunning: boolean;
  speed: number;
  onSpeedChange: (v: number) => void;
  onToggleSim: () => void;
  simError: string | null;
  inflow: number;
  windowNegRate: number;
  alerts: Alert[];
  onDismissAlert: (id: string) => void;
  liveComments: CommentRow[];
}

/** 实时监控卡：模拟器控制 + 流入指标 + 告警横幅 + 实时评论流 */
export default function LiveMonitor({
  simRunning,
  speed,
  onSpeedChange,
  onToggleSim,
  simError,
  inflow,
  windowNegRate,
  alerts,
  onDismissAlert,
  liveComments,
}: Props) {
  return (
    <Card className="mt-4">
      <CardHeader icon={<Activity size={15} />} title="实时监控" />
      <div className="p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={speed} onChange={(e) => onSpeedChange(Number(e.target.value))} className="h-8 w-28 text-xs">
            <option value={1}>1x 慢速</option>
            <option value={5}>5x 正常</option>
            <option value={10}>10x 加速</option>
            <option value={20}>20x 极速</option>
          </Select>
          <Button variant={simRunning ? "danger" : "primary"} size="sm" onClick={onToggleSim}>
            {simRunning ? <Pause size={13} /> : <Play size={13} />}
            {simRunning ? "停止" : "播放"}
          </Button>
          <span className="flex items-center gap-1.5 text-[13px] text-ink-400">
            {simRunning ? (
              <>
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
                评论实时流入中
              </>
            ) : (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-ink-500" />
                待机，点击播放开始
              </>
            )}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-ink-800 bg-ink-950 px-3 py-2">
            <div className="text-xs font-medium uppercase tracking-wider text-ink-400">已流入</div>
            <div className="mt-0.5 text-lg font-semibold tabular-nums text-ink-100">{inflow}</div>
          </div>
          <div className="rounded-lg border border-ink-800 bg-ink-950 px-3 py-2">
            <div className="text-xs font-medium uppercase tracking-wider text-ink-400">窗口负面率</div>
            <div className={`mt-0.5 text-lg font-semibold tabular-nums ${windowNegRate > 40 ? "text-red-400" : windowNegRate > 20 ? "text-amber-400" : "text-emerald-400"}`}>
              {windowNegRate}%
            </div>
          </div>
          <div className="rounded-lg border border-ink-800 bg-ink-950 px-3 py-2">
            <div className="text-xs font-medium uppercase tracking-wider text-ink-400">告警</div>
            <div className={`mt-0.5 text-lg font-semibold tabular-nums ${alerts.length > 0 ? "text-red-400" : "text-ink-100"}`}>
              {alerts.length}
            </div>
          </div>
        </div>

        {simError && <div className="mb-3 mt-3 text-xs text-red-400">{simError}</div>}

        <AnimatePresence>
          {alerts.map((a) => (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, y: -10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              transition={{ duration: 0.25 }}
              className={`mb-2 flex items-start gap-2.5 overflow-hidden rounded-lg border px-3.5 py-2.5 ${
                a.severity === "critical"
                  ? "border-red-800/60 bg-red-950/40"
                  : "border-amber-800/50 bg-amber-950/30"
              }`}
            >
              <Bell size={15} className={`mt-0.5 shrink-0 ${a.severity === "critical" ? "text-red-400" : "text-amber-400"}`} />
              <span className={`flex-1 text-[13px] leading-snug ${a.severity === "critical" ? "text-red-200" : "text-amber-200"}`}>
                {a.message}
              </span>
              <button
                onClick={() => onDismissAlert(a.id)}
                className="shrink-0 text-ink-400 transition-colors hover:text-ink-200"
              >
                <X size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>

        <div className="mt-3 h-56 overflow-hidden">
          {liveComments.length === 0 && !simRunning && (
            <div className="flex h-full items-center justify-center text-[13px] text-ink-400">
              点击「播放」后，评论将按时间轴实时流入
            </div>
          )}
          <AnimatePresence initial={false}>
            {liveComments.map((c) => (
              <motion.div
                key={c.id}
                layout
                initial={{ opacity: 0, y: -10, height: 0 }}
                animate={{ opacity: 1, y: 0, height: "auto" }}
                exit={{ opacity: 0, y: -6, height: 0, marginTop: 0 }}
                transition={{ duration: 0.2 }}
                className="mb-1.5 flex items-start gap-2.5 overflow-hidden rounded-lg border border-ink-800 bg-ink-950 px-3 py-2"
              >
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${SENTIMENT[c.sentiment].dot}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] leading-snug text-ink-100">{c.content}</div>
                  <div className="mt-0.5 text-xs text-ink-400">
                    {c.author} · {c.platform}
                  </div>
                </div>
                <Badge tone={c.sentiment}>{SENTIMENT[c.sentiment].label}</Badge>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </Card>
  );
}
