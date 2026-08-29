# -*- coding: utf-8 -*-
"""两项目简介：删角色句，改为微信图片风格的「基于X开发，支持A/B/C/D」句式"""
import re
import sys
import shutil
import zipfile

SRC = r"E:\qdzl\personal\page-001.docx"
TMP = r"E:\qdzl\personal\plfx\insight\.page-001.intro.docx"
sys.stdout.reconfigure(encoding="utf-8")

P1_OLD = "  基于 Next.js 16（App Router）+ React 19 + TypeScript 独立开发的全栈 AI 评论分析与舆情监控平台，负责前端整体架构与全部核心交互，覆盖评论导入、情感分析、实时监控、智能告警与舆情报告五大模块，对接 Express 后端与 OpenAI 兼容大模型完成批量分析。"
P1_NEW = "  基于 Next.js 16（App Router）+ React 19 + TypeScript 独立开发的全栈 AI 评论分析与舆情监控平台，支持多方式评论导入、批量情感分析、实时监控、智能告警与 AI 舆情周报，内置 3 个预标注舆情场景（1300+ 条评论）免 key 开箱即用，对接 Express 后端与 OpenAI 兼容大模型完成批量分析。"

P2_OLD = "  基于 Next.js 16（App Router）+ React 19 + TypeScript 独立开发的前后端分离个人主页与博客系统，负责前端整体架构与全部核心交互：简历展示、MDX 博客、AI 阅读助手、评论互动与管理后台，配套 Express + MySQL 后端。"
P2_NEW = "  基于 Next.js 16（App Router）+ React 19 + TypeScript 独立开发的前后端分离个人主页与博客系统，支持简历展示、MDX 博客发布、AI 阅读助手、评论互动与管理后台，配套 Express + MySQL 后端。"


def replace_wt(seg, old_text, new_text):
    m = re.search(r"<w:t[^>]*>" + re.escape(old_text) + r"</w:t>", seg)
    assert m, "未找到可替换 w:t"
    return seg[: m.start()] + m.group(0).replace(old_text, new_text, 1) + seg[m.end():]


with zipfile.ZipFile(SRC) as z:
    xml = z.read("word/document.xml").decode("utf-8")

paras = [(m.start(), m.end()) for m in re.finditer(r"<w:p\b.*?</w:p>", xml, re.S)]
texts = [re.sub(r"<[^>]+>", "", p) for p in (xml[a:b] for a, b in paras)]

idx1 = next(i for i, t in enumerate(texts) if "负责前端整体架构与全部核心交互，覆盖评论导入" in t)
idx2 = next(i for i, t in enumerate(texts) if "负责前端整体架构与全部核心交互：简历展示" in t)
print("简介段:", idx1, idx2)

out = xml
for idx, old, new in [(idx1, P1_OLD, P1_NEW), (idx2, P2_OLD, P2_NEW)]:
    a, b = paras[idx]
    seg = out[a:b]
    assert old in re.sub(r"<[^>]+>", "", seg), "段内文本不匹配"
    out = out[:a] + replace_wt(seg, old, new) + out[b:]

with zipfile.ZipFile(TMP, "w", zipfile.ZIP_DEFLATED) as zout:
    with zipfile.ZipFile(SRC) as zin:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "word/document.xml":
                data = out.encode("utf-8")
            zout.writestr(item, data)

try:
    shutil.copyfile(TMP, SRC)
    print("OK：已直接写入原文件")
except PermissionError:
    shutil.copyfile(TMP, r"E:\qdzl\personal\page-001.简介版.docx")
    print("LOCKED：原文件被占用，已输出 page-001.简介版.docx")
