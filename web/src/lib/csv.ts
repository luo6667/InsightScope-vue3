/**
 * CSV 解析工具（从 ImportPage 提取,独立可测）：
 * - splitCsvLine：单行解析,支持双引号包裹字段、引号内逗号、转义引号 ""
 * - parseCsv：首行表头,支持中文/英文列名,引号包裹字段
 * - downloadCsvTemplate：下载带 UTF-8 BOM 的模板(Excel 打开不乱码)
 */

export interface CsvRow {
  content: string;
  author?: string;
  platform?: string;
  sentiment?: string;
}

/** 解析单行 CSV：支持双引号包裹字段、引号内逗号、转义引号 "" */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** 简单 CSV 解析：首行表头，支持中文/英文列名，引号包裹字段 */
export function parseCsv(text: string): CsvRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.replace(/^"|"$/g, ""));
  const findCol = (names: string[]) => {
    const idx = header.findIndex((h) => names.includes(h.toLowerCase()));
    return idx >= 0 ? idx : -1;
  };
  const colContent = Math.max(0, findCol(["content", "评论", "内容", "text"]));
  const colAuthor = findCol(["author", "作者", "用户", "昵称"]);
  const colPlatform = findCol(["platform", "平台", "来源"]);
  const colSentiment = findCol(["sentiment", "情感", "情绪"]);

  const rows: CsvRow[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const content = cells[colContent] ?? "";
    if (!content) continue;
    const row: CsvRow = { content };
    if (colAuthor >= 0) row.author = cells[colAuthor];
    if (colPlatform >= 0) row.platform = cells[colPlatform];
    if (colSentiment >= 0) row.sentiment = cells[colSentiment];
    rows.push(row);
  }
  return rows;
}

/** 下载 CSV 模板（带 UTF-8 BOM，Excel 打开不乱码） */
export function downloadCsvTemplate(): void {
  const csv = [
    "评论,作者,平台,情感",
    "快递太慢了，等了三天才到,小明,淘宝,neg",
    "客服态度很好，问题解决很快,小红,京东,pos",
    "手机用起来很流畅，性能不错,阿伟,天猫,pos",
  ].join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "评论导入模板.csv";
  a.click();
  URL.revokeObjectURL(url);
}
