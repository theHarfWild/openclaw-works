import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";

/**
 * Paper viewer component for OpenClaw control UI.
 *
 * Supports two modes:
 *  - "pdf":  Fetches compiled PDF via paper.pdf.get, renders in an iframe.
 *  - "source": Fetches main.tex source via paper.maintex.read, displays as text.
 *
 * Usage: <paper-viewer .client=${...} .taskId=${"mytask"} mode="pdf"></paper-viewer>
 */
@customElement("paper-viewer")
export class PaperViewer extends LitElement {
  static styles = css`
    :host {
      display: block;
      height: 100%;
      overflow: auto;
      background: var(--bg, #fff);
    }

    .paper-container {
      display: flex;
      flex-direction: column;
      height: 100%;
    }

    .paper-toolbar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 1rem;
      background: var(--surface-secondary, #f5f5f5);
      border-bottom: 1px solid var(--border, #e0e0e0);
      flex-shrink: 0;
      flex-wrap: wrap;
    }

    .paper-toolbar label {
      font-size: 0.85rem;
      font-weight: 500;
    }

    .paper-toolbar input {
      padding: 0.25rem 0.5rem;
      border: 1px solid var(--border, #ccc);
      border-radius: 4px;
      font-size: 0.85rem;
      min-width: 180px;
    }

    .paper-toolbar button {
      padding: 0.3rem 0.75rem;
      border: 1px solid var(--border, #ccc);
      border-radius: 4px;
      background: var(--btn-bg, #fff);
      cursor: pointer;
      font-size: 0.85rem;
      white-space: nowrap;
    }

    .paper-toolbar button:hover {
      background: var(--btn-hover-bg, #e8e8e8);
    }

    .paper-toolbar button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .paper-toolbar button.primary {
      background: var(--primary, #2563eb);
      color: #fff;
      border-color: var(--primary, #2563eb);
    }

    .paper-toolbar button.primary:hover {
      background: var(--primary-hover, #1d4ed8);
    }

    .paper-toolbar .status {
      font-size: 0.8rem;
      margin-left: auto;
    }

    .paper-toolbar .status.success {
      color: #16a34a;
    }

    .paper-toolbar .status.error {
      color: #dc2626;
    }

    .paper-toolbar .status.loading {
      color: #6b7280;
    }

    .paper-content {
      flex: 1;
      overflow: auto;
      padding: 1rem;
    }

    .paper-content iframe {
      width: 100%;
      height: 100%;
      border: none;
      min-height: 600px;
    }

    .paper-content pre {
      white-space: pre-wrap;
      font-family: "Courier New", Courier, monospace;
      font-size: 0.85rem;
      line-height: 1.5;
      background: var(--code-bg, #fafafa);
      padding: 1rem;
      border-radius: 4px;
      border: 1px solid var(--border, #e0e0e0);
      max-width: 900px;
      margin: 0 auto;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-secondary, #6b7280);
      gap: 0.75rem;
      text-align: center;
      padding: 2rem;
    }

    .empty-state .icon {
      font-size: 3rem;
      opacity: 0.4;
    }

    .compile-errors {
      margin-top: 0.5rem;
      padding: 0.5rem;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 4px;
      color: #991b1b;
      font-size: 0.8rem;
      white-space: pre-wrap;
      max-height: 200px;
      overflow: auto;
    }
  `;

  @property({ attribute: false }) client: any = null;
  @property({ type: String }) taskId: string | null = null;
  @property({ type: String }) mode: "pdf" | "source" = "pdf";
  @property({ type: Boolean }) autoReload = true;

  @state() private loading = false;
  @state() private compileStatus: "idle" | "compiling" | "success" | "error" = "idle";
  @state() private compileErrors: string[] = [];
  @state() private pdfUrl: string | null = null;
  @state() private sourceContent: string = "";
  @state() private error: string | null = null;

  private pollTimer: ReturnType<typeof setInterval> | null = null;

  // Track last PDF metadata to avoid unnecessary re-renders
  private _lastPdfSize = -1;
  private _lastSourceContent = "";

  connectedCallback() {
    super.connectedCallback();
    if (this.taskId) {
      this.loadContent();
      if (this.autoReload && this.mode === "pdf") {
        this.startPolling();
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopPolling();
    this.revokePdfUrl();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("taskId") && this.taskId) {
      this.revokePdfUrl();
      this._lastPdfSize = -1;
      this._lastSourceContent = "";
      this.loadContent();
      if (this.autoReload && this.mode === "pdf") {
        this.stopPolling();
        this.startPolling();
      }
    }
    if (changed.has("mode")) {
      this.loadContent();
    }
  }

  private revokePdfUrl() {
    if (this.pdfUrl) {
      URL.revokeObjectURL(this.pdfUrl);
      this.pdfUrl = null;
    }
  }

  async loadContent() {
    if (!this.taskId || !this.client) return;
    this.loading = true;
    this.error = null;

    try {
      if (this.mode === "pdf") {
        await this.loadPdf();
      } else {
        await this.loadSource();
      }
    } catch (err: unknown) {
      this.error = String(err);
    } finally {
      this.loading = false;
    }
  }

  private async loadPdf() {
    try {
      const result = await this.client.request("paper.pdf.get", {
        taskId: this.taskId,
      });
      const base64 = result.pdfBase64;
      const size: number = result.size ?? 0;
      if (!base64) return;

      // Compare with last loaded PDF — skip if unchanged
      if (size === this._lastPdfSize) return;
      this._lastPdfSize = size;

      // Revoke old URL and create new one
      this.revokePdfUrl();
      const byteChars = atob(base64);
      const byteNums = new Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        byteNums[i] = byteChars.charCodeAt(i);
      }
      const byteArr = new Uint8Array(byteNums);
      const blob = new Blob([byteArr], { type: "application/pdf" });
      this.pdfUrl = URL.createObjectURL(blob);
      this.error = null;
    } catch (err: unknown) {
      // PDF might not have been compiled yet — that's ok
      this.pdfUrl = null;
    }
  }

  private async loadSource() {
    try {
      const result = await this.client.request("paper.maintex.read", {
        taskId: this.taskId,
      });
      const content: string = result.content ?? "";
      // Skip if unchanged
      if (content === this._lastSourceContent) return;
      this._lastSourceContent = content;
      this.sourceContent = content;
      this.error = null;
    } catch (err: unknown) {
      this.sourceContent = "";
      this.error = String(err);
    }
  }

  async handleCompile() {
    if (!this.taskId || !this.client || this.compileStatus === "compiling") return;

    this.compileStatus = "compiling";
    this.compileErrors = [];

    try {
      const result = await this.client.request("paper.compile", {
        taskId: this.taskId,
      });

      if (result.success && result.pdfExists) {
        this.compileStatus = "success";
        await this.loadPdf();
      } else {
        this.compileStatus = "error";
        this.compileErrors = result.errorLog ?? [];
        // If pdf exists despite errors, try loading it
        if (result.pdfExists) {
          await this.loadPdf();
        }
      }
    } catch (err: unknown) {
      this.compileStatus = "error";
      this.compileErrors = [String(err)];
    }
  }

  private startPolling() {
    this.pollTimer = setInterval(() => {
      if (this.mode === "pdf" && this.taskId) {
        this.loadPdf();
      }
    }, 10000);
  }

  private stopPolling() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  render() {
    if (!this.taskId) {
      return html`
        <div class="paper-container">
          <div class="empty-state">
            <div class="icon">📄</div>
            <div>No paper task selected</div>
            <div style="font-size:0.8rem">
              Enter a task ID or create a new paper above.
            </div>
          </div>
        </div>
      `;
    }

    return html`
      <div class="paper-container">
        <div class="paper-toolbar">
          <label>Task:</label>
          <span style="font-family:monospace;font-size:0.85rem">${this.taskId}</span>

          <button
            class="${this.mode === "pdf" ? "primary" : ""}"
            ?disabled=${!this.taskId}
            @click=${() => { this.mode = "pdf"; }}
          >
            PDF View
          </button>
          <button
            class="${this.mode === "source" ? "primary" : ""}"
            ?disabled=${!this.taskId}
            @click=${() => { this.mode = "source"; }}
          >
            Source (.tex)
          </button>

          <!-- Compile button (visible in both modes) -->
          <button
            class="primary"
            ?disabled=${!this.taskId || this.compileStatus === "compiling"}
            @click=${() => this.handleCompile()}
          >
            ${this.compileStatus === "compiling" ? "Compiling..." : "🔄 Compile"}
          </button>

          <span
            class="status ${this.compileStatus === "success"
              ? "success"
              : this.compileStatus === "error"
                ? "error"
                : "loading"}"
          >
            ${this.compileStatus === "success"
              ? "✓ Compiled"
              : this.compileStatus === "compiling"
                ? "Compiling..."
                : ""}
          </span>

          ${this.loading ? html`<span class="status loading">Loading...</span>` : ""}
          ${this.error ? html`<span class="status error">${this.error}</span>` : ""}
        </div>

        ${this.compileErrors.length > 0
          ? html`<div class="compile-errors">
              <strong>Compilation Errors:</strong>
              ${this.compileErrors.map((e) => html`<div>• ${e}</div>`)}
            </div>`
          : ""}

        <div class="paper-content">
          ${this.mode === "pdf"
            ? this.pdfUrl
              ? html`<iframe src=${this.pdfUrl} title="PDF Preview"></iframe>`
              : html`
                  <div class="empty-state">
                    <div class="icon">📑</div>
                    <div>No PDF available yet</div>
                    <div style="font-size:0.8rem">
                      Click "Compile" to generate the PDF, or switch to "Source" view.
                    </div>
                  </div>
                `
            : this.sourceContent
              ? html`<pre>${this.sourceContent}</pre>`
              : this.loading
                ? html`<div class="empty-state"><div class="icon">⏳</div><div>Loading...</div></div>`
                : html`<div class="empty-state">
                    <div class="icon">📝</div><div>No content yet</div>
                  </div>`}
        </div>
      </div>
    `;
  }
}

// Also register the old latex-viewer custom element for backward compatibility
@customElement("latex-viewer")
export class LatexViewer extends PaperViewer {}
