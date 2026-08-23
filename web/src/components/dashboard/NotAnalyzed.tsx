/** 未分析占位（图表区域数据为空时展示） */
export default function NotAnalyzed({ h }: { h: string }) {
  return (
    <div className={`flex ${h} items-center justify-center rounded-lg border border-dashed border-ink-700 text-[13px] text-ink-400`}>
      尚未分析，待 AI 分析后展示
    </div>
  );
}
