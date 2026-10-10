import * as vscode from "vscode";
import { disciplineById } from "./disciplines";
import { resolveApiKey } from "./env";
import { formatBytes } from "./format";
import { GeminiClient, isAbort, isMissingEnvironment, isTimeout } from "./gemini";
import { webviewDocument } from "./html";
import { packWorkspace } from "./pack";
import { AGENT, buildTurnInput } from "./prompt";
import type { AgentTurn, HostToWebview, Snapshot, UserTurn, WebviewToHost } from "./protocol";
import { parseVerityReport } from "./report";
import { visibleActivities, type RunState } from "./reduce";

const STATE_ENV = "verity.environmentId";
const STATE_PREV = "verity.previousInteractionId";
const STATE_FP = "verity.fingerprint";
const STATE_ROOT = "verity.root";

export class VerityViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewId = "verity.agent";

  private view?: vscode.WebviewView;
  private readonly channel: vscode.OutputChannel;
  private readonly subscriptions: vscode.Disposable[] = [];
  private turns: Array<UserTurn | AgentTurn> = [];
  private running = false;
  private abort?: AbortController;
  private environmentId?: string;
  private previousInteractionId?: string;
  private fingerprint?: string;
  private fileCount = -1;
  private sessionEpoch = 0;
  private runEpoch = 0;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.channel = vscode.window.createOutputChannel("Verity");
    this.subscriptions.push(this.channel);
    this.environmentId = context.workspaceState.get(STATE_ENV);
    this.previousInteractionId = context.workspaceState.get(STATE_PREV);
    this.fingerprint = context.workspaceState.get(STATE_FP);
    const storedRoot = context.workspaceState.get<string>(STATE_ROOT);
    const root = this.rootPath();
    if (storedRoot && root && storedRoot !== root) {
      this.environmentId = undefined;
      this.previousInteractionId = undefined;
      this.fingerprint = undefined;
    }
    const watcher = vscode.workspace.createFileSystemWatcher("**/.env");
    this.subscriptions.push(
      watcher,
      watcher.onDidCreate(() => this.postStatus()),
      watcher.onDidChange(() => this.postStatus()),
      watcher.onDidDelete(() => this.postStatus()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.fileCount = -1;
        this.postStatus();
        void this.refreshFileCount();
      }),
    );
  }

  dispose(): void {
    this.abort?.abort();
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
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      this.post({ type: "notice", message: "Open a folder first, then add GEMINI_API_KEY to its .env file." });
      return;
    }
    const target = vscode.Uri.joinPath(folder.uri, ".env");
    try {
      await vscode.workspace.fs.stat(target);
    } catch {
      const example = vscode.Uri.joinPath(this.context.extensionUri, ".env.example");
      let contents = Buffer.from("GEMINI_API_KEY=\n");
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
    const previous = this.environmentId;
    const root = this.rootPath();
    this.environmentId = undefined;
    this.previousInteractionId = undefined;
    this.fingerprint = undefined;
    this.turns = [];
    this.running = false;
    await this.persist(root);
    this.post({
      type: "snapshot",
      snapshot: { turns: [], running: false, sandboxLabel: "No sandbox" },
    });
    this.postStatus();
    if (previous && root) {
      const key = resolveApiKey(root);
      if (key) {
        void new GeminiClient(key, (line) => this.channel.appendLine(line)).deleteEnvironment(previous);
      }
    }
  }

  private async onMessage(message: WebviewToHost): Promise<void> {
    if (message.type === "ready") {
      this.postStatus();
      this.post({ type: "init", ...this.statusPayload(), agent: AGENT });
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
      syncLabel: "Reading the folder…",
    };
    const agent: AgentTurn = {
      role: "agent",
      phase: "Reading the open folder",
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
      await this.pipeline(user, agent, prompt, true);
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

  private async pipeline(
    user: UserTurn,
    agent: AgentTurn,
    prompt: string,
    allowRecovery: boolean,
  ): Promise<void> {
    const root = this.rootPath();
    if (!root) {
      throw new Error("Open a folder first. Verity tests the project in this window.");
    }
    const key = resolveApiKey(root);
    if (!key) {
      throw new Error("Add GEMINI_API_KEY to the .env file in this folder.");
    }
    const client = new GeminiClient(key, (line) => this.channel.appendLine(line));
    const signal = this.abort?.signal ?? AbortSignal.timeout(1);
    const hadEnvironment = Boolean(this.environmentId);

    this.setPhase(agent, hadEnvironment ? "Reading the open folder" : "Reading the folder and provisioning a sandbox");
    const packPromise = packWorkspace(root);
    const bootPromise = hadEnvironment ? null : client.bootstrap(signal);
    const packed = await packPromise;
    if (this.runEpoch !== this.sessionEpoch) {
      return;
    }
    if (!packed.files.length) {
      throw new Error("This folder has no source files Verity can read.");
    }
    this.fileCount = packed.files.length;
    const bytes = packed.files.reduce((sum, file) => sum + file.bytes, 0);
    user.syncLabel = [
      `${packed.files.length} files`,
      formatBytes(bytes),
      packed.skippedEnv ? ".env left out" : "",
    ]
      .filter(Boolean)
      .join(" · ");

    if (bootPromise) {
      const boot = await bootPromise;
      if (this.runEpoch !== this.sessionEpoch) {
        void client.deleteEnvironment(boot.environmentId);
        return;
      }
      this.environmentId = boot.environmentId;
      this.previousInteractionId = boot.interactionId;
      await this.persist(root);
      this.postStatus();
    }

    const environmentId = this.environmentId;
    if (!environmentId) {
      throw new Error("The sandbox did not return an environment id, so the project could not be uploaded.");
    }

    const refreshed = this.fingerprint !== packed.fingerprint;
    if (refreshed) {
      this.setPhase(agent, `Uploading ${packed.files.length} files`);
      try {
        await client.upload(environmentId, packed.archive, signal);
        if (this.runEpoch !== this.sessionEpoch) {
          return;
        }
      } catch (error) {
        if (this.runEpoch !== this.sessionEpoch) {
          return;
        }
        if (allowRecovery && hadEnvironment && isMissingEnvironment(error)) {
          this.channel.appendLine("Stored sandbox is gone. Provisioning a new one.");
          await this.forgetSandbox();
          return this.pipeline(user, agent, prompt, false);
        }
        throw error;
      }
      this.fingerprint = packed.fingerprint;
      await this.persist(root);
      user.syncLabel += " · synced";
    } else {
      user.syncLabel += " · sandbox is current";
    }
    this.postRun({ type: "sync", label: user.syncLabel });

    this.setPhase(agent, "Running functional tests");
    let finished;
    try {
      finished = await client.run(
        {
          environmentId: this.environmentId ?? environmentId,
          previousInteractionId: this.previousInteractionId,
          input: buildTurnInput({
            userPrompt: prompt,
            files: packed.files.map((file) => file.path),
            refreshed,
          }),
          onUpdate: (state) => this.applyRun(agent, state),
        },
        signal,
      );
    } catch (error) {
      if (allowRecovery && hadEnvironment && isMissingEnvironment(error)) {
        this.channel.appendLine("Stored sandbox is gone. Provisioning a new one.");
        await this.forgetSandbox();
        return this.pipeline(user, agent, prompt, false);
      }
      throw error;
    }
    if (this.runEpoch !== this.sessionEpoch) {
      return;
    }

    if (finished.environmentId) {
      this.environmentId = finished.environmentId;
    }
    if (finished.interactionId) {
      this.previousInteractionId = finished.interactionId;
    }
    await this.persist(root);
    this.applyRun(agent, finished.state);

    const downloaded = await client.downloadReport(this.environmentId ?? environmentId, signal);
    const report = (downloaded && parseVerityReport(downloaded)) || parseVerityReport(agent.answer);
    if (report) {
      agent.report = report;
      this.postRun({ type: "report", report });
    }
    agent.usage = finished.state.usage;
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

  private applyRun(agent: AgentTurn, state: RunState): void {
    if (this.runEpoch !== this.sessionEpoch) {
      return;
    }
    agent.answer = state.answer;
    if (state.usage) {
      agent.usage = state.usage;
    }
    for (const item of visibleActivities(state)) {
      const existing = agent.activities.find((activity) => activity.id === item.id);
      if (!existing) {
        agent.activities.push(item);
        this.postRun({ type: "activity", item });
        continue;
      }
      if (existing.title !== item.title || existing.body !== item.body) {
        existing.title = item.title;
        existing.body = item.body;
        this.postRun({ type: "activity", item });
      }
    }
    this.postRun({ type: "answer", text: state.answer });
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
      agent.error = error instanceof Error ? error.message : "The run failed.";
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
    if (!resolveApiKey(this.rootPath())) {
      return "Add GEMINI_API_KEY to the .env file in this folder.";
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
      hasKey: Boolean(resolveApiKey(this.rootPath())),
      sandboxLabel: this.sandboxLabel(),
    };
  }

  private sandboxLabel(): string {
    if (this.running) {
      return "Sandbox running";
    }
    if (this.environmentId) {
      return "Sandbox ready";
    }
    return "No sandbox";
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

  private async persist(root: string | undefined): Promise<void> {
    await this.context.workspaceState.update(STATE_ENV, this.environmentId);
    await this.context.workspaceState.update(STATE_PREV, this.previousInteractionId);
    await this.context.workspaceState.update(STATE_FP, this.fingerprint);
    await this.context.workspaceState.update(STATE_ROOT, root);
  }

  private async forgetSandbox(): Promise<void> {
    this.environmentId = undefined;
    this.previousInteractionId = undefined;
    this.fingerprint = undefined;
    await this.persist(this.rootPath());
  }

  private post(message: HostToWebview): void {
    void this.view?.webview.postMessage(message);
  }
}

function cryptoRandom(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
