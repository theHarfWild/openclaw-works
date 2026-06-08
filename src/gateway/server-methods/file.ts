// flows/gateway/server-methods/file.ts
import fs from "node:fs/promises";
import path from "node:path";

import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../../agents/agent-scope.js";
import { normalizeAgentId } from "../../routing/session-key.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import type { GatewayRequestHandlers } from "./types.js";

export const fileHandlers: GatewayRequestHandlers = {
  "file.read": async ({ params, respond, context }) => {
    const filePath = normalizeOptionalString(
      (params as { path?: string }).path,
    );
    if (!filePath) {
      respond(false, undefined, {
        code: "INVALID_PARAMS",
        message: "Missing or invalid path",
      });
      return;
    }

    const cfg = context.getRuntimeConfig();
    const agentIdRaw = normalizeOptionalString(
      (params as { agentId?: string }).agentId,
    ) ?? resolveDefaultAgentId(cfg);
    const agentId = normalizeAgentId(agentIdRaw);
    const workspaceRoot = resolveAgentWorkspaceDir(cfg, agentId);

    // Build safe absolute path rooted at the agent workspace
    const safePath = path.resolve(workspaceRoot, filePath);

    // Security: ensure resolved path stays within workspace
    if (!safePath.startsWith(path.resolve(workspaceRoot))) {
      respond(false, undefined, {
        code: "ACCESS_DENIED",
        message: "Access denied: path escapes workspace",
      });
      return;
    }

    try {
      let content = await fs.readFile(safePath, "utf-8");
      // Wrap .tex files in a code block for better markdown rendering
      if (filePath.endsWith(".tex")) {
        content = `\`\`\`latex\n${content}\n\`\`\``;
      }
      respond(true, { content, path: safePath });
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        respond(false, undefined, {
          code: "NOT_FOUND",
          message: `File not found: ${filePath}`,
        });
      } else {
        respond(false, undefined, {
          code: "READ_ERROR",
          message: e.message,
        });
      }
    }
  },

  "file.write": async ({ params, respond, context }) => {
    const filePath = normalizeOptionalString(
      (params as { path?: string }).path,
    );
    const content = (params as { content?: string }).content;
    if (!filePath) {
      respond(false, undefined, {
        code: "INVALID_PARAMS",
        message: "Missing or invalid path",
      });
      return;
    }
    if (typeof content !== "string") {
      respond(false, undefined, {
        code: "INVALID_PARAMS",
        message: "Missing or invalid content",
      });
      return;
    }

    const cfg = context.getRuntimeConfig();
    const agentIdRaw = normalizeOptionalString(
      (params as { agentId?: string }).agentId,
    ) ?? resolveDefaultAgentId(cfg);
    const agentId = normalizeAgentId(agentIdRaw);
    const workspaceRoot = resolveAgentWorkspaceDir(cfg, agentId);
    const safePath = path.resolve(workspaceRoot, filePath);

    if (!safePath.startsWith(path.resolve(workspaceRoot))) {
      respond(false, undefined, {
        code: "ACCESS_DENIED",
        message: "Access denied: path escapes workspace",
      });
      return;
    }

    try {
      const dir = path.dirname(safePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(safePath, content, "utf-8");
      respond(true, { path: safePath, written: true });
    } catch (err: unknown) {
      respond(false, undefined, {
        code: "WRITE_ERROR",
        message: (err as Error).message,
      });
    }
  },

  "file.list": async ({ params, respond, context }) => {
    const dirPath = normalizeOptionalString(
      (params as { path?: string }).path,
    ) ?? ".";

    const cfg = context.getRuntimeConfig();
    const agentIdRaw = normalizeOptionalString(
      (params as { agentId?: string }).agentId,
    ) ?? resolveDefaultAgentId(cfg);
    const agentId = normalizeAgentId(agentIdRaw);
    const workspaceRoot = resolveAgentWorkspaceDir(cfg, agentId);
    const safePath = path.resolve(workspaceRoot, dirPath);

    if (!safePath.startsWith(path.resolve(workspaceRoot))) {
      respond(false, undefined, {
        code: "ACCESS_DENIED",
        message: "Access denied: path escapes workspace",
      });
      return;
    }

    try {
      const entries = await fs.readdir(safePath, { withFileTypes: true });
      const files = entries.map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
      }));
      respond(true, { path: safePath, files });
    } catch (err: unknown) {
      respond(false, undefined, {
        code: "LIST_ERROR",
        message: (err as Error).message,
      });
    }
  },
};
