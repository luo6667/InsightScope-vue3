/** 时段对比的日期区间选择（DashboardPage 时段对比用） */
export default function RangeField({
  label,
  range,
  onChange,
}: {
  label: string;
  range: { from: string; to: string };
  onChange: (r: { from: string; to: string }) => void;
}) {
  const inputCls = "h-8 rounded-lg border border-ink-700 bg-ink-950 px-2 text-xs text-ink-100 outline-none focus:border-accent-500";
  return (
    <div className="flex items-end gap-2">
      <span className="pb-1.5 text-xs font-medium text-ink-300">{label}</span>
      <input type="date" value={range.from} onChange={(e) => onChange({ ...range, from: e.target.value })} className={inputCls} />
      <span className="pb-1.5 text-ink-400">~</span>
      <input type="date" value={range.to} onChange={(e) => onChange({ ...range, to: e.target.value })} className={inputCls} />
    </div>
  );
}
