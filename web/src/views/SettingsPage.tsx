import { BookMarked, Check, KeyRound, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button, Card, CardHeader, Field, Input, PageHeader, Textarea } from "../components/ui";
import { getCustomDict, setCustomDict } from "../lib/customDict";
import { aiSettingsSchema, fieldErrors } from "../lib/validation";
import { useSettings } from "../store/settings";

export default function SettingsPage() {
  const s = useSettings();
  const [draft, setDraft] = useState({ ...s });
  const [dictText, setDictText] = useState(getCustomDict().join("\n"));

  // zod 字段级校验（语义与原手写 ASCII 检查一致，并覆盖长度/范围）
  const parsed = aiSettingsSchema.safeParse(draft);
  const errs = parsed.success ? {} : fieldErrors(parsed.error);
  const keyInvalid = !!errs.apiKey;
  const urlInvalid = !!errs.baseUrl;

  const save = () => {
    if (!parsed.success) return;
    const { apiKey, baseUrl, model, temperature } = parsed.data;
    // key 去掉所有空白（sk- 格式），其余字段已由 schema trim / 范围校验
    const cleanKey = apiKey.replace(/\s+/g, "");
    s.update({ ...draft, apiKey: cleanKey, baseUrl, model, temperature });
    setDraft({ ...draft, apiKey: cleanKey, baseUrl, model, temperature });
    toast.success("AI 服务设置已保存");
  };

  const saveDict = () => {
    const words = dictText.split(/[\n,，、]+/).map((w) => w.trim()).filter(Boolean);
    setCustomDict(words);
    toast.success("自定义词典已保存（词云统计生效）");
  };

  return (
    <div className="mx-auto max-w-xl px-6 py-8">
      <PageHeader title="设置" desc="AI 连接与关键词词典配置" />

      <Card className="mt-6">
        <CardHeader
          icon={<KeyRound size={15} />}
          title="AI 服务"
          extra={
            <span className="flex items-center gap-1.5 text-xs text-ink-400">
              <ShieldCheck size={12} />
              key 仅存本浏览器
            </span>
          }
        />
        <div className="space-y-4 p-5">
          <Field
            label="API Base URL"
            hint="兼容 OpenAI 协议即可，如 DeepSeek 填 https://api.deepseek.com/v1"
            error={urlInvalid ? "Base URL 含非 ASCII 字符，请检查" : undefined}
          >
            <Input value={draft.baseUrl} onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" />
          </Field>
          <Field
            label="API Key"
            hint="分析时随任务传给本地后端，仅内存不落库"
            error={keyInvalid ? "key 混入了非 ASCII 字符，只保留 sk-... 那段" : undefined}
          >
            <Input
              type="password"
              value={draft.apiKey}
              onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              placeholder="sk-..."
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="模型">
              <Input value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} placeholder="gpt-4o-mini" />
            </Field>
            <Field label="temperature">
              <Input
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={draft.temperature}
                onChange={(e) => {
                  const v = e.target.value;
                  const n = v === "" ? 0 : Number(v);
                  // NaN 时保持原值，避免非法值进入状态
                  setDraft({ ...draft, temperature: Number.isFinite(n) ? n : draft.temperature });
                }}
              />
            </Field>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <Button variant="primary" onClick={save} disabled={keyInvalid || urlInvalid}>
              保存设置
            </Button>
          </div>
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader
          icon={<BookMarked size={15} />}
          title="自定义关键词词典"
          extra={
            <span className="flex items-center gap-1.5 text-xs text-ink-400">
              <Check size={12} />
              词云统计生效
            </span>
          }
        />
        <div className="p-5">
          <Field
            label="自定义关键词（每行一个，或逗号分隔）"
            hint="添加产品名、特定槽点等词，评论中出现该词就会计入关键词云统计（与内置评价词典合并）"
          >
            <Textarea
              value={dictText}
              onChange={(e) => setDictText(e.target.value)}
              rows={6}
              placeholder={"例如：\n某产品名\n发货慢\n包装破损\n客服敷衍"}
            />
          </Field>
          <div className="mt-4">
            <Button variant="primary" onClick={saveDict}>
              保存词典
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
