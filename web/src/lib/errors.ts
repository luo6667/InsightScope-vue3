/**
 * 统一错误提取：把任意抛出的值转成可展示的消息。
 * 替代各页面重复的 `e instanceof Error ? e.message : String(e)`。
 */
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
