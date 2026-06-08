# 项目修改记录 (correct.md)

本文档记录基于 需求.md 对 openclaw 项目进行二次开发的所有改动，并未记录6月7日之前对于前后端以及skill的改动。

---

## 2026-06-07 — 初始化 correct.md

**描述:** 创建修改记录文件，用于追踪后续所有改动。

**文件:** `correct.md` (新建)

---

## 2026-06-07 — 创建 paper.ts 网关方法

**描述:** 新增论文相关的后端网关方法，包括工作区初始化、章节读写、LaTeX编译、PDF获取、实验执行等。

**文件:**
- `src/gateway/server-methods/paper.ts` (新建)
- `src/gateway/server-methods.ts` (修改) — 注册 paperHandlers

**新增方法:** paper.workspace.init, paper.workspace.list, paper.maintex.read, paper.maintex.write, paper.section.read, paper.section.replace, paper.compile, paper.pdf.get, paper.exp.run, paper.file.read, paper.file.write

---

## 2026-06-07 — 创建 paper-writing 技能定义

**描述:** 创建论文写作技能的 SKILL.md，定义完整的工作流状态机。

**文件:** `skills/paper-writing/SKILL.md` (新建)

---

## 2026-06-07 — 重写前端论文查看器组件

**描述:** 将 latex-viewer.ts 重写为支持 taskId 的 paper-viewer 组件，支持 PDF 渲染和 LaTeX 源码查看，内置编译按钮。

**文件:**
- `ui/src/ui/components/latex-viewer.ts` (重写)
- `ui/src/ui/app-render.ts` (修改)
- `ui/src/ui/app-view-state.ts` (修改)
- `ui/src/ui/app.ts` (修改)
- `ui/src/i18n/locales/zh-CN.ts` (修改)

---

## 2026-06-07 — 修复 file.ts 安全与代码质量问题

**描述:** 重构 file.ts，移除调试代码，新增 file.write 和 file.list 方法，改进路径验证。

**文件:** `src/gateway/server-methods/file.ts` (修改)

---

## 2026-06-07 — 修复 paper-writing 技能不可见问题

**问题:** SKILL.md 的 `requires.bins: [python3]` + `requires.anyBins: [latexmk, pdflatex]` 导致 OpenClaw 技能引擎在 Windows 上过滤掉该技能（缺少对应二进制）。

**修复:** 移除 `requires` 字段。

**文件:** `skills/paper-writing/SKILL.md` (修改)

---

## 2026-06-07 — SKILL.md 改用现有工具替代 paper.* 网关方法

**问题:** paper.* 网关方法只在 gateway server 端注册，agent 的工具集 (bash/read/write/web_search) 不包含通用网关方法透传机制。
`gateway` tool 只支持 restart/config.get/config.apply 等，agent 无法调用 paper.* 方法。

**修复:** 重写 SKILL.md，指导 agent 使用现有工具完成论文写作流程：
- 目录创建 → `bash` with `mkdir -p`
- 文件读写 → `read` / `write` 工具
- 实验执行 → `bash` with `python`
- LaTeX 编译 → `bash` with `latexmk`
- 文献检索 → `web_search`

paper.* 网关方法保留用于前端 paper-viewer 组件调用。

**文件:** `skills/paper-writing/SKILL.md` (重写)

---

## 2026-06-07 — PDF 动态扫描 + 前端论文页自动填充任务

**Bug:** paper.compile/pdf.get 写死 main.pdf。修复为 findPdfInDir() 扫描目录找任意 .pdf。

**功能:** 论文 Tab 加载时自动调用 paper.workspace.list，自动选中任务（优先选带 PDF 的）。

**文件:** src/gateway/server-methods/paper.ts, ui/src/ui/app-render.ts

