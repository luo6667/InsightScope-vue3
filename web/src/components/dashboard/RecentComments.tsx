import { Gauge } from "lucide-react";

import type { CommentRow } from "../../api/types";
import { formatTime } from "../../lib/format";
import { Button, Card, CardHeader } from "../ui";
import { SENTIMENT } from "./options";

interface Props {
  comments?: CommentRow[];
  topicFilter: string | null;
  onTopicFilterChange: (t: string | null) => void;
  onSelect: (c: CommentRow) => void;
}

/** 最近评论列表：可点击查看详情,主题钻取时展示筛选结果与清除按钮 */
export default function RecentComments({ comments, topicFilter, onTopicFilterChange, onSelect }: Props) {
  return (
    <Card className="mt-4">
      <CardHeader
        icon={<Gauge size={15} />}
        title={topicFilter ? `「${topicFilter}」相关评论` : "最近评论"}
        extra={
          topicFilter && (
            <Button size="sm" variant="ghost" onClick={() => onTopicFilterChange(null)}>
              清除筛选
            </Button>
          )
        }
      />
      <div className="divide-y divide-ink-800">
        {comments?.map((c) => (
          <button
            key={c.id}
            onClick={() => onSelect(c)}
            className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-ink-850"
          >
            <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${SENTIMENT[c.sentiment].dot}`} />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] text-ink-100">{c.content}</div>
              <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-400">
                <span>{c.author}</span>
                <span>·</span>
                <span>{c.platform}</span>
                <span className="ml-auto tabular-nums">{formatTime(c.timestamp)}</span>
              </div>
              {c.topics.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {c.topics.map((t) => (
                    <span key={t} className="cursor-pointer rounded-md bg-ink-800 px-1.5 py-0.5 text-xs text-ink-300 hover:bg-ink-700">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
}
