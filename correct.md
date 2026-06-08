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



---

## 开发环境使用指南

### 前置要求

- Node.js >= 22.12
- pnpm（通过 `npm install -g pnpm` 安装）
- Git
- DeepSeek API Key（或其他 OpenAI 兼容的 API Key）

### 1. 初始化

```bash
# 克隆项目
git clone https://github.com/theHarfWild/openclaw-works.git
cd openclaw-works

# 安装依赖
pnpm install

# 构建项目
pnpm build
pnpm ui:build
```

### 2. 配置 API Key

#### 方式一：创建项目级 .env（推荐）

在项目根目录创建 `.env` 文件：

```bash
echo DEEPSEEK_API_KEY=你的key > .env
```

#### 方式二：运行配置向导

```bash
node scripts/run-node.mjs --dev onboard
```

配置存储在 `~/.openclaw-dev/openclaw.json`，端口 19001。

#### 方式三：PyCharm / VS Code 环境变量

在 IDE 的 Run Configuration 中添加环境变量：
```
DEEPSEEK_API_KEY=你的key
```

### 3. 启动开发服务

**启动后端 Gateway（端口 19001）：**

```bash
pnpm gateway:dev
```

**启动前端 UI（端口 5173）：**

```bash
pnpm ui:dev
```

打开浏览器访问 `http://localhost:5173`，聊天 Tab 与 Agent 对话，
论文 Tab 查看 PDF 预览。

### 4. 使用论文写作功能

1. 在聊天 Tab 中，向 Agent 说 "帮我写一篇论文" 或 "write a paper about..."
2. Agent 将自动加载 paper-writing 技能，按状态机流程引导：
   - 确认主题 → 确认格式 → 确认结构 → 开始写作 → LaTeX 编译 → 修改迭代
3. 切换到「论文」Tab 可以实时查看 PDF 和 LaTeX 源码
4. 编译后的 PDF 在工作区 `~/.openclaw-dev/workspace-dev/paper_task_xxx/` 中

### 5. 端口说明

| 服务 | 开发模式端口 | 命令 |
|------|-------------|------|
| Gateway API | `ws://127.0.0.1:19001` | `pnpm gateway:dev` |
| Control UI | `http://localhost:5173` | `pnpm ui:dev` |
| Browser Control | `http://127.0.0.1:19003` | 自动启动 |

### 6. 停止服务

```bash
# 查找并停止占用端口的进程
netstat -ano | grep 19001    # 找到 PID
taskkill //F //PID <PID>     # 停止 Gateway

netstat -ano | grep 5173    # 找到 PID
taskkill //F //PID <PID>     # 停止 UI
```

### 7. 常见问题

**Q: Agent 看不到 paper-writing 技能？**
A: 确认 `skills/paper-writing/SKILL.md` 存在，且 gateway 已重启。
   如果仍不可见，检查是否有其他 skill filter 配置。

**Q: LaTeX 编译报错？**
A: Windows 上默认没有 LaTeX 环境。安装 MiKTeX 或 TeX Live 后即可编译。
   也可以仅编写 .tex 文件，在 Linux 上编译。

**Q: 前端 paper Tab 显示空白？**
A: 确认 gateway 已启动，且当前有已创建的论文任务。
   Tab 会自动从后端拉取任务列表并选中。

**Q: pnpm install 报错？**
A: 确保 Node.js >= 22.12，`node -v` 检查版本。
   如果用 npm 安装 pnpm 失败，尝试 `npm install -g pnpm --registry=https://registry.npmmirror.com`。

