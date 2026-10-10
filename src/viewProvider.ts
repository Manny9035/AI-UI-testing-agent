import { readFile } from "fs/promises";
import path from "path";
import * as vscode from "vscode";
import type { JsonlLocalAgentStore, SDKMessage } from "@cursor/sdk";
import {
  CursorSession,
  explainCursorError,
  isAbort,
  isTimeout,
  openAgentStore,
  Stopped,
} from "./cursorSession";
import { disciplineById } from "./disciplines";
import { resolveApiKey } from "./env";
import { clip } from "./format";
import { webviewDocument } from "./html";
import { packWorkspace } from "./pack";
import { buildTurnInput, COMPOSER_LABEL, REPORT_PATH } from "./prompt";
import type { ActivityItem, AgentTurn, HostToWebview, Snapshot, UserTurn, WebviewToHost } from "./protocol";
import { parseVerityReport } from "./report";

const STATE_AGENT = "verity.cursorAgentId";
const STATE_ROOT = "verity.root";

export class VerityViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewId = "verity.agent";

  private view?: vscode.WebviewView;
  private readonly channel: vscode.OutputChannel;
  private readonly subscriptions: vscode.Disposable[] = [];
  private turns: Array<UserTurn | AgentTurn> = [];
  private running = false;
  private abort?: AbortController;
  private cursorAgentId?: string;
  private session?: CursorSession;
  private store?: JsonlLocalAgentStore;
  private fileCount = -1;
  private sessionEpoch = 0;
  private runEpoch = 0;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.channel = vscode.window.createOutputChannel("Verity");
    this.subscriptions.push(this.channel);
    this.cursorAgentId = context.workspaceState.get(STATE_AGENT);
    const storedRoot = context.workspaceState.get<string>(STATE_ROOT);
    const root = this.rootPath();
    if (storedRoot && root && storedRoot !== root) {
      this.cursorAgentId = undefined;
    }
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.context.extensionUri, ".env"),
    );
    this.subscriptions.push(
      watcher,
      watcher.onDidCreate(() => this.postStatus()),
      watcher.onDidChange(() => this.postStatus()),
      watcher.onDidDelete(() => this.postStatus()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.fileCount = -1;
        this.cursorAgentId = undefined;
        const closing = this.session;
        this.session = undefined;
        void closing?.close();
        void this.persist(this.rootPath());
        this.postStatus();
        void this.refreshFileCount();
      }),
    );
  }

  dispose(): void {
    this.abort?.abort();
    void this.session?.close();
    for (const item of this.subscriptions) {
      item.dispose();
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    const { webview } = webviewView;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };
    const nonce = cryptoRandom();
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "media", "webview.css"));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js"));
    webview.html = webviewDocument({
      nonce,
      cspSource: webview.cspSource,
      styleUri: String(styleUri),
      scriptUri: String(scriptUri),
    });
    webview.onDidReceiveMessage((message: WebviewToHost) => {
      void this.onMessage(message);
    });
    void this.refreshFileCount();
  }

  async openEnvFile(): Promise<void> {
    const target = vscode.Uri.joinPath(this.context.extensionUri, ".env");
    try {
      await vscode.workspace.fs.stat(target);
    } catch {
      const example = vscode.Uri.joinPath(this.context.extensionUri, ".env.example");
      let contents = Buffer.from("CURSOR_API_KEY=\n");
      try {
        contents = Buffer.from(await vscode.workspace.fs.readFile(example));
      } catch {
        // The example ships with the extension; a one-line file is enough if it is missing.
      }
      await vscode.workspace.fs.writeFile(target, contents);
    }
    const document = await vscode.workspace.openTextDocument(target);
    await vscode.window.showTextDocument(document, { preview: false });
  }

  async newSession(): Promise<void> {
    this.sessionEpoch++;
    if (this.running) {
      this.abort?.abort();
    }
    const root = this.rootPath();
    this.cursorAgentId = undefined;
    const closing = this.session;
    this.session = undefined;
    this.turns = [];
    this.running = false;
    await this.persist(root);
    this.post({
      type: "snapshot",
      snapshot: { turns: [], running: false, sandboxLabel: "No session" },
    });
    this.postStatus();
    await closing?.close();
  }

  private async onMessage(message: WebviewToHost): Promise<void> {
    if (message.type === "ready") {
      this.postStatus();
      this.post({ type: "init", ...this.statusPayload(), agent: COMPOSER_LABEL });
      this.post({ type: "snapshot", snapshot: this.snapshot() });
      return;
    }
    if (message.type === "openEnv") {
      await this.openEnvFile();
      return;
    }
    if (message.type === "newSession") {
      await this.newSession();
      return;
    }
    if (message.type === "cancel") {
      this.abort?.abort();
      return;
    }
    if (message.type === "send") {
      await this.onSend(message.discipline, message.prompt);
    }
  }

  private async onSend(disciplineId: string, prompt: string): Promise<void> {
    if (this.running) {
      return;
    }
    const problem = this.precondition(disciplineId);
    if (problem) {
      this.post({ type: "notice", message: problem });
      this.postStatus();
      return;
    }
    const discipline = disciplineById(disciplineId)!;
    const user: UserTurn = {
      role: "user",
      disciplineLabel: discipline.slash,
      prompt: prompt.trim(),
      syncLabel: "Composer Fast is reading this folder",
    };
    const agent: AgentTurn = {
      role: "agent",
      phase: "Starting Composer Fast",
      activities: [],
      answer: "",
      startedAt: Date.now(),
    };
    this.turns.push(user, agent);
    this.runEpoch = this.sessionEpoch;
    this.running = true;
    this.abort = new AbortController();
    this.postRun({ type: "run-start", turn: user });
    this.postRun({ type: "phase", label: agent.phase });
    this.postStatus();
    try {
      await this.pipeline(user, agent, prompt);
    } catch (error) {
      if (this.runEpoch === this.sessionEpoch) {
        this.failTurn(agent, error);
      }
    } finally {
      if (this.runEpoch !== this.sessionEpoch) {
        return;
      }
      this.running = false;
      this.abort = undefined;
      if (!agent.endedAt) {
        agent.endedAt = Date.now();
      }
      this.postStatus();
    }
  }

  private async pipeline(user: UserTurn, agent: AgentTurn, prompt: string): Promise<void> {
    const root = this.rootPath();
    if (!root) {
      throw new Error("Open a folder first. Verity tests the project in this window.");
    }
    const key = resolveApiKey(this.extensionRoot());
    if (!key) {
      throw new Error("Add CURSOR_API_KEY to the .env file in the Verity folder.");
    }
    const signal = this.abort?.signal ?? AbortSignal.timeout(1);
    this.setPhase(agent, "Starting Composer Fast");
    user.syncLabel = "Composer Fast is reading this folder";
    this.postRun({ type: "sync", label: user.syncLabel });

    try {
      this.session = await CursorSession.open({
        apiKey: key,
        cwd: root,
        store: await this.agentStore(),
        agentId: this.cursorAgentId,
      });
    } catch (error) {
      throw explainCursorError(error);
    }
    this.cursorAgentId = this.session.agentId;
    await this.persist(root);
    this.postStatus();
    if (this.runEpoch !== this.sessionEpoch) {
      return;
    }

    this.setPhase(agent, "Running functional tests");
    this.channel.appendLine(`Composer agent ${this.session.agentId}`);
    let result;
    try {
      result = await this.session.send(buildTurnInput(prompt), {
        signal,
        onEvent: (event) => this.onCursorEvent(agent, event),
      });
    } catch (error) {
      throw explainCursorError(error);
    }
    if (this.runEpoch !== this.sessionEpoch) {
      return;
    }
    if (result.status === "cancelled") {
      throw new Stopped();
    }
    if (result.status === "error") {
      throw new Error(result.error?.message || "Composer could not finish this run.");
    }
    if (result.result) {
      this.setAnswer(agent, result.result);
    }
    if (result.usage) {
      agent.usage = `${result.usage.totalTokens.toLocaleString("en-US")} tokens`;
    }
    this.channel.appendLine(`Run ${result.id} finished${result.requestId ? ` request ${result.requestId}` : ""}`);

    const report = (await this.readReport(root)) || parseVerityReport(agent.answer);
    if (report) {
      agent.report = report;
      this.postRun({ type: "report", report });
    }
    agent.phase = "Finished";
    agent.endedAt = Date.now();
    this.postRun({ type: "phase", label: agent.phase });
    this.postRun({ type: "run-end", usage: agent.usage, endedAt: agent.endedAt });
    this.postStatus();
  }

  private postRun(message: HostToWebview): void {
    if (this.runEpoch !== this.sessionEpoch) {
      return;
    }
    this.post(message);
  }

  private onCursorEvent(agent: AgentTurn, event: SDKMessage): void {
    if (this.runEpoch !== this.sessionEpoch) {
      return;
    }
    if (event.type === "thinking") {
      this.upsertActivity(agent, {
        id: "thinking",
        kind: "thought",
        title: "Thinking",
        body: appendText(agent.activities.find((item) => item.id === "thinking")?.body, event.text),
      });
      return;
    }
    if (event.type === "tool_call") {
      const title = event.status === "running" ? event.name : `${event.name} · ${event.status}`;
      this.upsertActivity(agent, {
        id: event.call_id,
        kind: "tool",
        title,
        body: clip([present(event.args), event.status === "running" ? "" : present(event.result)].filter(Boolean).join("\n"), 1200),
      });
      this.setPhase(agent, event.status === "running" ? event.name : "Running functional tests");
      return;
    }
    if (event.type === "assistant") {
      const text = event.message.content
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("");
      if (text) {
        this.setAnswer(agent, mergeAnswer(agent.answer, text));
      }
      return;
    }
    if (event.type === "usage") {
      agent.usage = `${event.usage.totalTokens.toLocaleString("en-US")} tokens`;
      return;
    }
    if (event.type === "task" && event.text) {
      this.setPhase(agent, event.text);
    }
  }

  private upsertActivity(agent: AgentTurn, item: ActivityItem): void {
    const existing = agent.activities.find((activity) => activity.id === item.id);
    if (!existing) {
      agent.activities.push(item);
    } else {
      existing.title = item.title;
      existing.body = item.body;
      existing.kind = item.kind;
    }
    this.postRun({ type: "activity", item });
  }

  private setAnswer(agent: AgentTurn, text: string): void {
    agent.answer = text;
    this.postRun({ type: "answer", text });
  }

  private async readReport(root: string) {
    try {
      const raw = await readFile(path.join(root, REPORT_PATH), "utf8");
      return parseVerityReport(raw);
    } catch {
      return undefined;
    }
  }

  private async agentStore(): Promise<JsonlLocalAgentStore> {
    if (!this.store) {
      const directory = path.join(this.context.globalStorageUri.fsPath, "cursor-agents");
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(directory));
      this.store = await openAgentStore(directory);
    }
    return this.store;
  }

  private failTurn(agent: AgentTurn, error: unknown): void {
    const endedAt = Date.now();
    agent.endedAt = endedAt;
    if (isAbort(error)) {
      agent.error = "Stopped before the run finished.";
      agent.phase = "Stopped";
    } else if (isTimeout(error)) {
      agent.error = "This run went past the time limit. Start a new session if you want a clean pass.";
      agent.phase = "Timed out";
    } else {
      const explained = explainCursorError(error);
      agent.error = explained.message;
      agent.phase = "Could not finish";
    }
    this.channel.appendLine(agent.error ?? "The run failed.");
    this.postRun({ type: "phase", label: agent.phase });
    this.postRun({ type: "run-error", message: agent.error ?? "The run failed.", endedAt });
  }

  private setPhase(agent: AgentTurn, label: string): void {
    if (this.runEpoch !== this.sessionEpoch) {
      return;
    }
    agent.phase = label;
    this.channel.appendLine(label);
    this.postRun({ type: "phase", label });
  }

  private precondition(disciplineId: string): string | null {
    const discipline = disciplineById(disciplineId);
    if (!discipline) {
      return "Choose a testing discipline from the + menu.";
    }
    if (!discipline.enabled) {
      return `${discipline.title} is not in this build. Functional Testing is ready.`;
    }
    if (!this.rootPath()) {
      return "Open a folder first. Verity tests the project in this window.";
    }
    if (!resolveApiKey(this.extensionRoot())) {
      return "Add CURSOR_API_KEY to the .env file in the Verity folder.";
    }
    return null;
  }

  private async refreshFileCount(): Promise<void> {
    const root = this.rootPath();
    if (!root) {
      this.fileCount = 0;
      this.postStatus();
      return;
    }
    try {
      const packed = await packWorkspace(root);
      this.fileCount = packed.files.length;
    } catch (error) {
      this.channel.appendLine(error instanceof Error ? error.message : "Could not read the folder.");
      this.fileCount = 0;
    }
    this.postStatus();
  }

  private postStatus(): void {
    const payload = this.statusPayload();
    this.post({ type: "status", ...payload });
  }

  private statusPayload(): {
    workspaceName: string | null;
    fileCount: number;
    hasKey: boolean;
    sandboxLabel: string;
  } {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return {
      workspaceName: folder?.name ?? null,
      fileCount: this.fileCount,
      hasKey: Boolean(resolveApiKey(this.extensionRoot())),
      sandboxLabel: this.sandboxLabel(),
    };
  }

  private sandboxLabel(): string {
    if (this.running) {
      return "Composer Fast running";
    }
    if (this.cursorAgentId) {
      return "Composer Fast ready";
    }
    return "No session";
  }

  private snapshot(): Snapshot {
    return {
      turns: this.turns.map((turn) => ({ ...turn, activities: turn.role === "agent" ? [...turn.activities] : undefined })),
      running: this.running,
      sandboxLabel: this.sandboxLabel(),
    } as Snapshot;
  }

  private rootPath(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private extensionRoot(): string {
    return this.context.extensionPath;
  }

  private async persist(root: string | undefined): Promise<void> {
    await this.context.workspaceState.update(STATE_AGENT, this.cursorAgentId);
    await this.context.workspaceState.update(STATE_ROOT, root);
  }

  private post(message: HostToWebview): void {
    void this.view?.webview.postMessage(message);
  }
}

function appendText(current: string | undefined, next: string): string {
  if (!current) {
    return next;
  }
  if (next.startsWith(current)) {
    return next;
  }
  return current + next;
}

function mergeAnswer(current: string, next: string): string {
  if (!next) {
    return current;
  }
  if (!current || next.startsWith(current)) {
    return next;
  }
  if (current.endsWith(next)) {
    return current;
  }
  return current + next;
}

function present(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function cryptoRandom(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
