/**
 * 📘 lib/download.ts —— 浏览器下载的统一实现
 *
 * 原先三处各写一份「createObjectURL + a.click + revoke」：api/api.ts（导出评论）、
 * lib/csv.ts（下载模板）、views/ReportsView.vue（导出 Markdown），统一到这里。
 *
 * 注意：`<a download>` 是浏览器原生跳转，**不会带上 Authorization 头**，
 * 因此需要鉴权的导出（后端启用 ACCESS_TOKEN 时）必须改用带 token 的请求方式，
 * 见 api/api.ts 里 exportComments 的说明。
 */

/** 触发浏览器下载一个 URL（同源链接或 objectURL） */
export function downloadUrl(url: string, filename: string): void {
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
}

/** 下载一段文本（Blob → objectURL，点击后立即释放） */
export function downloadText(
  text: string,
  filename: string,
  mime = 'text/plain;charset=utf-8',
): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  downloadUrl(url, filename)
  URL.revokeObjectURL(url)
}
