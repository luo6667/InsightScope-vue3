/**
 * 滑动窗口 Z-score 异常检测：
 * 给定数值序列，计算均值与标准差，判断最新值是否显著偏离（|z| >= threshold）。
 * 用于识别"负面率突增"等舆情异常。
 */
/**
 * 📘 services/anomalyService.ts —— Z-score 异常检测（纯算法，无副作用，可单测）
 *
 * 输入一串数值（负面率采样序列），用“历史窗口”计算均值 mean 与标准差 stdDev，
 * 当前值偏离超过 threshold 个标准差（|z| >= threshold）→ 判为异常（舆情负面突增）。
 * 设计要点：基线只用当前值之前的窗口算（当前值不污染基线）；样本 < 5 不判断。
 */
export interface AnomalyResult {
  isAnomaly: boolean;
  zScore: number;
  mean: number;
  stdDev: number;
  current: number;
}

export function detectAnomaly(values: number[], threshold = 2): AnomalyResult | null {
  if (values.length < 5) return null; // 样本太少不做判断
  const current = values[values.length - 1];
  const window = values.slice(0, -1); // 用历史窗口算基线，避免当前值污染
  const mean = window.reduce((s, v) => s + v, 0) / window.length;
  const variance = window.reduce((s, v) => s + (v - mean) ** 2, 0) / window.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev < 1e-6) return { isAnomaly: false, zScore: 0, mean, stdDev, current };
  const zScore = (current - mean) / stdDev;
  return { isAnomaly: Math.abs(zScore) >= threshold, zScore, mean, stdDev, current };
}
