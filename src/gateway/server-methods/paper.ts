/**
 * Paper-writing gateway handlers.
 *
 * Provides methods for:
 *  - Workspace initialization
 *  - Section-level read / replace (targeted .tex editing)
 *  - LaTeX compilation (latexmk)
 *  - PDF retrieval
 *  - Experiment sandbox execution
 */
import { execSync } from "child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import type { GatewayRequestHandlers } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find a PDF file in the given directory (non-recursive).
 * Returns the first .pdf found, or null if none exists.
 */
function findPdfInDir(dir: string): string | null {
  try {
    const entries = fs.readdirSync(dir);
    for (const name of entries) {
      if (name.toLowerCase().endsWith(".pdf")) {
        return path.join(dir, name);
      }
    }
  } catch {
    // ignore
  }
  return null;
}

function resolveWorkspaceRoot(cfg: Record<string, unknown>): string {
  const defaults = (cfg as { agents?: { defaults?: { workspace?: string } } }).agents?.defaults;
  const workspaceRoot = defaults?.workspace?.trim();
  if (!workspaceRoot) {
    throw new Error(
      "No workspace configured. Set agents.defaults.workspace in your config.",
    );
  }
  return workspaceRoot;
}

function resolvePaperTaskDir(workspaceRoot: string, taskId: string): string {
  // Sanitize taskId to prevent path traversal
  const safe = taskId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  if (!safe) {
    throw new Error("Invalid taskId: must contain at least one valid character");
  }
  return path.resolve(workspaceRoot, `paper_task_${safe}`);
}

function ensureDirSync(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function error(code: string, message: string) {
  return { code, message };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const paperHandlers: GatewayRequestHandlers = {
  // ── Workspace Init ────────────────────────────────────────────────────
  "paper.workspace.init": async ({ params, respond, context }) => {
    const { taskId } = params as { taskId?: string };
    if (!taskId || typeof taskId !== "string") {
      respond(false, undefined, error("INVALID_PARAMS", "taskId is required"));
      return;
    }

    try {
      const cfg = context.getRuntimeConfig() as unknown as Record<string, unknown>;
      const workspaceRoot = resolveWorkspaceRoot(cfg);
      const taskDir = resolvePaperTaskDir(workspaceRoot, taskId);

      // Create standard directory structure
      const dirs = [
        taskDir,
        path.join(taskDir, "figures"),
        path.join(taskDir, "exp_sandbox"),
      ];

      for (const dir of dirs) {
        ensureDirSync(dir);
      }

      // Create skeleton files if they don't exist
      const mainTexPath = path.join(taskDir, "main.tex");
      if (!fs.existsSync(mainTexPath)) {
        const skeleton = [
          "% Paper: " + taskId,
          "\\documentclass[conference]{IEEEtran}",
          "",
          "\\begin{document}",
          "",
          "\\title{Paper Title}",
          "\\author{Author}",
          "\\maketitle",
          "",
          "% Sections will be added incrementally",
          "",
          "\\end{document}",
          "",
        ].join("\n");
        await fsp.writeFile(mainTexPath, skeleton, "utf-8");
      }

      const bibPath = path.join(taskDir, "references.bib");
      if (!fs.existsSync(bibPath)) {
        await fsp.writeFile(bibPath, "% References\n", "utf-8");
      }

      respond(true, {
        taskDir,
        files: {
          mainTex: mainTexPath,
          bib: bibPath,
          figuresDir: path.join(taskDir, "figures"),
          expSandboxDir: path.join(taskDir, "exp_sandbox"),
        },
      });
    } catch (err: unknown) {
      respond(false, undefined, error("WORKSPACE_ERROR", String(err)));
    }
  },

  // ── Paper Task List ───────────────────────────────────────────────────
  "paper.workspace.list": ({ params, respond, context }) => {
    try {
      const cfg = context.getRuntimeConfig() as unknown as Record<string, unknown>;
      const workspaceRoot = resolveWorkspaceRoot(cfg);

      if (!fs.existsSync(workspaceRoot)) {
        respond(true, { tasks: [] });
        return;
      }

      const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
      const tasks = entries
        .filter((e) => e.isDirectory() && e.name.startsWith("paper_task_"))
        .map((e) => {
          const taskDir = path.join(workspaceRoot, e.name);
          const mainTex = path.join(taskDir, "main.tex");
          const existingPdf = findPdfInDir(taskDir);
          const taskId = e.name.slice("paper_task_".length);
          return {
            taskId,
            taskDir,
            hasMainTex: fs.existsSync(mainTex),
            hasPdf: existingPdf !== null,
            pdfName: existingPdf ? path.basename(existingPdf) : null,
          };
        })
        .sort((a, b) => a.taskId.localeCompare(b.taskId));

      respond(true, { tasks });
    } catch (err: unknown) {
      respond(false, undefined, error("LIST_ERROR", String(err)));
    }
  },

  // ── Section Read ──────────────────────────────────────────────────────
  "paper.section.read": async ({ params, respond, context }) => {
    const { taskId, sectionName } = params as { taskId?: string; sectionName?: string };
    if (!taskId || typeof taskId !== "string") {
      respond(false, undefined, error("INVALID_PARAMS", "taskId is required"));
      return;
    }
    if (!sectionName || typeof sectionName !== "string") {
      respond(false, undefined, error("INVALID_PARAMS", "sectionName is required"));
      return;
    }

    try {
      const cfg = context.getRuntimeConfig() as unknown as Record<string, unknown>;
      const workspaceRoot = resolveWorkspaceRoot(cfg);
      const taskDir = resolvePaperTaskDir(workspaceRoot, taskId);
      const mainTex = path.join(taskDir, "main.tex");

      if (!fs.existsSync(mainTex)) {
        respond(false, undefined, error("NOT_FOUND", `main.tex not found for task ${taskId}`));
        return;
      }

      const content = await fsp.readFile(mainTex, "utf-8");
      const lines = content.split("\n");

      // Build regex to match \section{sectionName} through the start of the next \section
      const escapedName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const sectionRegex = new RegExp(
        `\\\\section\\s*\\{[^}]*${escapedName}[^}]*\\}`,
        "i",
      );

      let startLine = -1;
      let endLine = lines.length;
      const sectionLevels = ["\\section", "\\subsection", "\\subsubsection"];

      for (let i = 0; i < lines.length; i++) {
        if (startLine === -1 && sectionRegex.test(lines[i])) {
          startLine = i;
          continue;
        }
        if (startLine !== -1 && /\\section\{/.test(lines[i])) {
          endLine = i;
          break;
        }
      }

      if (startLine === -1) {
        respond(
          false,
          undefined,
          error("NOT_FOUND", `Section "${sectionName}" not found in main.tex`),
        );
        return;
      }

      const sectionContent = lines.slice(startLine, endLine).join("\n");
      respond(true, {
        taskId,
        sectionName,
        startLine: startLine + 1, // 1-indexed
        endLine,
        content: sectionContent,
      });
    } catch (err: unknown) {
      respond(false, undefined, error("READ_ERROR", String(err)));
    }
  },

  // ── Section Replace ────────────────────────────────────────────────────
  "paper.section.replace": async ({ params, respond, context }) => {
    const { taskId, sectionName, newContent } = params as {
      taskId?: string;
      sectionName?: string;
      newContent?: string;
    };
    if (!taskId || typeof taskId !== "string") {
      respond(false, undefined, error("INVALID_PARAMS", "taskId is required"));
      return;
    }
    if (!sectionName || typeof sectionName !== "string") {
      respond(false, undefined, error("INVALID_PARAMS", "sectionName is required"));
      return;
    }
    if (typeof newContent !== "string") {
      respond(false, undefined, error("INVALID_PARAMS", "newContent is required"));
      return;
    }

    try {
      const cfg = context.getRuntimeConfig() as unknown as Record<string, unknown>;
      const workspaceRoot = resolveWorkspaceRoot(cfg);
      const taskDir = resolvePaperTaskDir(workspaceRoot, taskId);
      const mainTex = path.join(taskDir, "main.tex");

      if (!fs.existsSync(mainTex)) {
        respond(false, undefined, error("NOT_FOUND", `main.tex not found for task ${taskId}`));
        return;
      }

      const content = await fsp.readFile(mainTex, "utf-8");
      const lines = content.split("\n");

      const escapedName = sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const sectionRegex = new RegExp(
        `\\\\section\\s*\\{[^}]*${escapedName}[^}]*\\}`,
        "i",
      );

      let startLine = -1;
      let endLine = lines.length;

      for (let i = 0; i < lines.length; i++) {
        if (startLine === -1 && sectionRegex.test(lines[i])) {
          startLine = i;
          continue;
        }
        if (startLine !== -1 && /\\section\{/.test(lines[i])) {
          endLine = i;
          break;
        }
      }

      if (startLine === -1) {
        respond(
          false,
          undefined,
          error("NOT_FOUND", `Section "${sectionName}" not found in main.tex`),
        );
        return;
      }

      // Replace: keep the section header, replace body
      const sectionHeader = lines[startLine];
      const before = lines.slice(0, startLine + 1).join("\n");
      const after = lines.slice(endLine).join("\n");
      const newBody = newContent.replace(/^\n+/, "").replace(/\n+$/, "");
      const newFull = [before, newBody, after].filter(Boolean).join("\n") + "\n";

      await fsp.writeFile(mainTex, newFull, "utf-8");

      respond(true, {
        taskId,
        sectionName,
        replaced: true,
      });
    } catch (err: unknown) {
      respond(false, undefined, error("WRITE_ERROR", String(err)));
    }
  },

  // ── LaTeX Compilation ────────────────────────────────────────────────
  "paper.compile": ({ params, respond, context }) => {
    const { taskId } = params as { taskId?: string };
    if (!taskId || typeof taskId !== "string") {
      respond(false, undefined, error("INVALID_PARAMS", "taskId is required"));
      return;
    }

    try {
      const cfg = context.getRuntimeConfig() as unknown as Record<string, unknown>;
      const workspaceRoot = resolveWorkspaceRoot(cfg);
      const taskDir = resolvePaperTaskDir(workspaceRoot, taskId);
      const mainTex = path.join(taskDir, "main.tex");

      if (!fs.existsSync(mainTex)) {
        respond(false, undefined, error("NOT_FOUND", `main.tex not found for task ${taskId}`));
        return;
      }

      // Run latexmk -pdf in the task directory
      const cmd = "latexmk";
      const args = ["-pdf", "-interaction=nonstopmode", "main.tex"];
      // Suppress stdout but capture everything

      let stdout = "";
      let stderr = "";
      try {
        const result = execSync([cmd, ...args].join(" ") + " 2>&1", {
          cwd: taskDir,
          timeout: 120_000, // 2-minute timeout
          encoding: "utf-8",
        });
        stdout = result;
      } catch (execErr: unknown) {
        // latexmk may exit non-zero on compilation errors — that's expected
        const e = execErr as { stdout?: string; stderr?: string; message?: string };
        stdout = e.stdout ?? "";
        stderr = e.stderr ?? "";
        if (!stdout && !stderr && e.message) {
          stderr = e.message;
        }
      }

      // Find compiled PDF (any name) in task directory
      const pdfPath = findPdfInDir(taskDir);
      const pdfExists = pdfPath !== null;

      respond(true, {
        taskId,
        success: pdfExists,
        pdfExists,
        pdfPath,
        stdout: stdout.slice(-10_000),
        stderr: stderr.slice(-10_000),
        errorLog: extractLatexErrors(stdout || stderr),
      });
    } catch (err: unknown) {
      respond(false, undefined, error("COMPILE_ERROR", String(err)));
    }
  },

  // ── PDF Retrieval ────────────────────────────────────────────────────
  "paper.pdf.get": async ({ params, respond, context }) => {
    const { taskId } = params as { taskId?: string };
    if (!taskId || typeof taskId !== "string") {
      respond(false, undefined, error("INVALID_PARAMS", "taskId is required"));
      return;
    }

    try {
      const cfg = context.getRuntimeConfig() as unknown as Record<string, unknown>;
      const workspaceRoot = resolveWorkspaceRoot(cfg);
      const taskDir = resolvePaperTaskDir(workspaceRoot, taskId);
      const pdfPath = findPdfInDir(taskDir);

      if (!pdfPath) {
        respond(
          false,
          undefined,
          error("NOT_FOUND", `No PDF found for task ${taskId}. Compile first.`),
        );
        return;
      }

      const pdfBuffer = await fsp.readFile(pdfPath);
      const base64 = pdfBuffer.toString("base64");

      respond(true, {
        taskId,
        pdfPath,
        pdfBase64: base64,
        size: pdfBuffer.length,
      });
    } catch (err: unknown) {
      respond(false, undefined, error("PDF_ERROR", String(err)));
    }
  },

  // ── Experiment Execution ──────────────────────────────────────────────
  "paper.exp.run": async ({ params, respond, context }) => {
    const { taskId, scriptName } = params as { taskId?: string; scriptName?: string };
    if (!taskId || typeof taskId !== "string") {
      respond(false, undefined, error("INVALID_PARAMS", "taskId is required"));
      return;
    }

    try {
      const cfg = context.getRuntimeConfig() as unknown as Record<string, unknown>;
      const workspaceRoot = resolveWorkspaceRoot(cfg);
      const taskDir = resolvePaperTaskDir(workspaceRoot, taskId);
      const expDir = path.join(taskDir, "exp_sandbox");

      if (!fs.existsSync(expDir)) {
        ensureDirSync(expDir);
      }

      const scriptFile = scriptName?.trim() || "run_exp.py";
      const scriptPath = path.resolve(expDir, scriptFile);

      if (!scriptPath.startsWith(expDir)) {
        respond(false, undefined, error("ACCESS_DENIED", "Script path escapes sandbox"));
        return;
      }

      if (!fs.existsSync(scriptPath)) {
        respond(false, undefined, error("NOT_FOUND", `Script not found: ${scriptFile}`));
        return;
      }

      const logPath = path.join(expDir, "exp_logs.txt");

      try {
        const result = execSync(`python "${scriptPath}"`, {
          cwd: expDir,
          timeout: 300_000, // 5-minute timeout
          encoding: "utf-8",
        });
        await fsp.writeFile(logPath, result, "utf-8");
        respond(true, {
          taskId,
          success: true,
          stdout: result.slice(-20_000),
          stderr: "",
          logPath,
        });
      } catch (execErr: unknown) {
        const e = execErr as { stdout?: string; stderr?: string; message?: string };
        const errText = (e.stdout ?? "") + "\n" + (e.stderr ?? e.message ?? "");
        await fsp.writeFile(logPath, errText, "utf-8");
        respond(true, {
          taskId,
          success: false,
          stdout: e.stdout?.slice(-10_000) ?? "",
          stderr: e.stderr?.slice(-10_000) ?? e.message ?? "",
          logPath,
        });
      }
    } catch (err: unknown) {
      respond(false, undefined, error("EXP_ERROR", String(err)));
    }
  },

  // ── Main.tex Read ────────────────────────────────────────────────────
  "paper.maintex.read": async ({ params, respond, context }) => {
    const { taskId } = params as { taskId?: string };
    if (!taskId || typeof taskId !== "string") {
      respond(false, undefined, error("INVALID_PARAMS", "taskId is required"));
      return;
    }

    try {
      const cfg = context.getRuntimeConfig() as unknown as Record<string, unknown>;
      const workspaceRoot = resolveWorkspaceRoot(cfg);
      const taskDir = resolvePaperTaskDir(workspaceRoot, taskId);
      const mainTex = path.join(taskDir, "main.tex");

      if (!fs.existsSync(mainTex)) {
        respond(false, undefined, error("NOT_FOUND", `main.tex not found for task ${taskId}`));
        return;
      }

      const content = await fsp.readFile(mainTex, "utf-8");
      respond(true, {
        taskId,
        path: mainTex,
        content,
        lineCount: content.split("\n").length,
      });
    } catch (err: unknown) {
      respond(false, undefined, error("READ_ERROR", String(err)));
    }
  },

  // ── Main.tex Write ────────────────────────────────────────────────────
  "paper.maintex.write": async ({ params, respond, context }) => {
    const { taskId, content } = params as { taskId?: string; content?: string };
    if (!taskId || typeof taskId !== "string") {
      respond(false, undefined, error("INVALID_PARAMS", "taskId is required"));
      return;
    }
    if (typeof content !== "string") {
      respond(false, undefined, error("INVALID_PARAMS", "content is required"));
      return;
    }

    try {
      const cfg = context.getRuntimeConfig() as unknown as Record<string, unknown>;
      const workspaceRoot = resolveWorkspaceRoot(cfg);
      const taskDir = resolvePaperTaskDir(workspaceRoot, taskId);
      const mainTex = path.join(taskDir, "main.tex");

      ensureDirSync(taskDir);
      await fsp.writeFile(mainTex, content, "utf-8");

      respond(true, {
        taskId,
        path: mainTex,
        written: true,
      });
    } catch (err: unknown) {
      respond(false, undefined, error("WRITE_ERROR", String(err)));
    }
  },

  // ── File Read (task-relative) ─────────────────────────────────────────
  "paper.file.read": async ({ params, respond, context }) => {
    const { taskId, filePath } = params as { taskId?: string; filePath?: string };
    if (!taskId || typeof taskId !== "string") {
      respond(false, undefined, error("INVALID_PARAMS", "taskId is required"));
      return;
    }
    if (!filePath || typeof filePath !== "string") {
      respond(false, undefined, error("INVALID_PARAMS", "filePath is required"));
      return;
    }

    try {
      const cfg = context.getRuntimeConfig() as unknown as Record<string, unknown>;
      const workspaceRoot = resolveWorkspaceRoot(cfg);
      const taskDir = resolvePaperTaskDir(workspaceRoot, taskId);
      const resolvedPath = path.resolve(taskDir, filePath);

      // Security: ensure the resolved path stays within the task directory
      if (!resolvedPath.startsWith(taskDir)) {
        respond(false, undefined, error("ACCESS_DENIED", "File path escapes task directory"));
        return;
      }

      if (!fs.existsSync(resolvedPath)) {
        respond(false, undefined, error("NOT_FOUND", `File not found: ${filePath}`));
        return;
      }

      const fileContent = await fsp.readFile(resolvedPath, "utf-8");
      respond(true, {
        taskId,
        path: resolvedPath,
        content: fileContent,
      });
    } catch (err: unknown) {
      respond(false, undefined, error("READ_ERROR", String(err)));
    }
  },

  // ── File Write (task-relative) ────────────────────────────────────────
  "paper.file.write": async ({ params, respond, context }) => {
    const { taskId, filePath, content } = params as {
      taskId?: string;
      filePath?: string;
      content?: string;
    };
    if (!taskId || typeof taskId !== "string") {
      respond(false, undefined, error("INVALID_PARAMS", "taskId is required"));
      return;
    }
    if (!filePath || typeof filePath !== "string") {
      respond(false, undefined, error("INVALID_PARAMS", "filePath is required"));
      return;
    }
    if (typeof content !== "string") {
      respond(false, undefined, error("INVALID_PARAMS", "content is required"));
      return;
    }

    try {
      const cfg = context.getRuntimeConfig() as unknown as Record<string, unknown>;
      const workspaceRoot = resolveWorkspaceRoot(cfg);
      const taskDir = resolvePaperTaskDir(workspaceRoot, taskId);
      const resolvedPath = path.resolve(taskDir, filePath);

      if (!resolvedPath.startsWith(taskDir)) {
        respond(false, undefined, error("ACCESS_DENIED", "File path escapes task directory"));
        return;
      }

      const dir = path.dirname(resolvedPath);
      ensureDirSync(dir);
      await fsp.writeFile(resolvedPath, content, "utf-8");

      respond(true, {
        taskId,
        path: resolvedPath,
        written: true,
      });
    } catch (err: unknown) {
      respond(false, undefined, error("WRITE_ERROR", String(err)));
    }
  },
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract human-readable error messages from LaTeX compilation output.
 */
function extractLatexErrors(log: string): string[] {
  if (!log) return [];
  const errors: string[] = [];
  const lines = log.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match lines starting with "!" which indicate LaTeX errors
    if (line.startsWith("!")) {
      const msg = line.replace(/^!\s*/, "").trim();
      // Grab the next line too (context line)
      const contextLine = i + 1 < lines.length ? lines[i + 1].trim() : "";
      errors.push(contextLine ? `${msg} (${contextLine})` : msg);
    }
  }
  return errors;
}
