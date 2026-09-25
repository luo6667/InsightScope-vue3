/**
 * CSV 解析工具（从 ImportPage 提取,独立可测）：
 * - splitCsvLine：单行解析,支持双引号包裹字段、引号内逗号、转义引号 ""
 * - parseCsv：逐字符状态机解析整份文本,支持中文/英文列名,引号字段内的换行原样保留
 * - downloadCsvTemplate：下载带 UTF-8 BOM 的模板(Excel 打开不乱码)
 */
import { downloadText } from './download'
import type { Sentiment } from './validation'

export interface CsvRow {
  content: string
  author?: string
  platform?: string
  sentiment?: Sentiment
}

/** 内容列表头别名（与既有实现一致，仅新增别名，不删旧别名） */
const CONTENT_HEADERS = ['content', '评论', '内容', '评论内容', 'comment', 'text', '正文']
const AUTHOR_HEADERS = ['author', '作者', '用户', '昵称']
const PLATFORM_HEADERS = ['platform', '平台', '来源']
const SENTIMENT_HEADERS = ['sentiment', '情感', '情绪']

/**
 * 逐字符状态机：把整份 CSV 文本切成「记录（行）→ 字段（列）」二维数组。
 * - 支持 \r\n / \n / \r 三种换行
 * - 引号字段内的换行原样保留在字段值里（不再按行 split，长评论不会被撕成两条）
 * - 引号字段用 "" 表示一个 "
 * - 开头 BOM（\uFEFF）去掉
 * - 引号字段内容不 trim；非引号字段才 trim
 */
function splitCsvRecords(text: string): string[][] {
  const src = text.startsWith('\uFEFF') ? text.slice(1) : text
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let inQuotes = false
  /** 当前字段是否被引号包裹：决定该字段是否参与 trim */
  let wasQuoted = false

  const pushField = () => {
    record.push(wasQuoted ? field : field.trim())
    field = ''
    wasQuoted = false
  }
  const pushRecord = () => {
    pushField()
    records.push(record)
    record = []
  }

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      wasQuoted = true
    } else if (ch === ',') {
      pushField()
    } else if (ch === '\n') {
      pushRecord()
    } else if (ch === '\r') {
      if (src[i + 1] === '\n') i++
      pushRecord()
    } else {
      field += ch
    }
  }
  // 收尾：文本不以换行结束时补最后一条记录；空文本也返回一条空记录（与旧 splitCsvLine('') → [''] 一致）
  if (field !== '' || record.length > 0 || wasQuoted || inQuotes || records.length === 0) {
    pushRecord()
  }
  return records
}

/** 解析单行 CSV：支持双引号包裹字段、引号内逗号、转义引号 "" */
export function splitCsvLine(line: string): string[] {
  return splitCsvRecords(line)[0] ?? []
}

/** 情感列值规范化：中文/英文别名 → pos | neu | neg;无法识别返回 undefined（由后端兜底 neu） */
const sentimentMap: Record<string, 'pos' | 'neu' | 'neg'> = {
  pos: 'pos',
  positive: 'pos',
  正面: 'pos',
  好评: 'pos',
  积极: 'pos',
  满意: 'pos',
  neu: 'neu',
  neutral: 'neu',
  中性: 'neu',
  一般: 'neu',
  中评: 'neu',
  neg: 'neg',
  negative: 'neg',
  负面: 'neg',
  差评: 'neg',
  消极: 'neg',
  不满意: 'neg',
}
function normalizeSentiment(raw: string): 'pos' | 'neu' | 'neg' | undefined {
  const v = raw.trim().toLowerCase()
  return sentimentMap[v] ?? sentimentMap[raw.trim()]
}

/** 表头别名匹配（小写比较，与既有实现相同） */
function findCol(header: string[], names: string[]): number {
  const idx = header.findIndex((h) => names.includes(h.toLowerCase()))
  return idx >= 0 ? idx : -1
}

/**
 * CSV 解析：首行表头（中文/英文列名均可），引号字段支持换行。
 * 表头识别不到内容列时抛中文错误，不再静默取第 0 列；
 * 只有单列文件（整行就是一条评论、没有表头）才回退到第 0 列作为内容。
 */
export function parseCsv(text: string): CsvRow[] {
  // 丢掉全空行（去引号后每个字段都为空），等价旧的 split(/\r?\n/).map(trim).filter(Boolean)
  const records = splitCsvRecords(text).filter((r) => r.some((f) => f !== ''))
  if (records.length < 2) return []

  const header = records[0]
  const colContent = findCol(header, CONTENT_HEADERS)
  const colAuthor = findCol(header, AUTHOR_HEADERS)
  const colPlatform = findCol(header, PLATFORM_HEADERS)
  const colSentiment = findCol(header, SENTIMENT_HEADERS)

  // 单列且首行不是内容列别名 → 视为无表头文件：每一条记录本身就是一条评论
  if (header.length === 1 && colContent < 0) {
    return records.map((r) => ({ content: r[0] ?? '' })).filter((row) => row.content !== '')
  }
  if (colContent < 0) {
    throw new Error(
      'CSV 缺少评论内容列：未识别到表头（支持 content/评论内容/内容/comment/text/正文 等）',
    )
  }

  const rows: CsvRow[] = []
  for (const cells of records.slice(1)) {
    const content = cells[colContent] ?? ''
    if (!content) continue
    const row: CsvRow = { content }
    if (colAuthor >= 0) row.author = cells[colAuthor]
    if (colPlatform >= 0) row.platform = cells[colPlatform]
    if (colSentiment >= 0) {
      const sent = normalizeSentiment(cells[colSentiment] ?? '')
      if (sent) row.sentiment = sent
    }
    rows.push(row)
  }
  return rows
}

/** 下载 CSV 模板（带 UTF-8 BOM，Excel 打开不乱码） */
export function downloadCsvTemplate(): void {
  const csv = [
    '评论,作者,平台,情感',
    '快递太慢了，等了三天才到,小明,淘宝,neg',
    '客服态度很好，问题解决很快,小红,京东,pos',
    '手机用起来很流畅，性能不错,阿伟,天猫,pos',
  ].join('\r\n')
  downloadText('\uFEFF' + csv, '评论导入模板.csv', 'text/csv;charset=utf-8')
}
