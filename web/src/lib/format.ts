/** 统一时间格式化（zh-CN 本地化），替代各处重复的 new Date(x).toLocaleString("zh-CN") */
export function formatTime(ts: string | number | Date): string {
  return new Date(ts).toLocaleString('zh-CN')
}
