import { renderMarkdown } from "./markdown";
import type { ActivityItem, AgentTurn, HostToWebview, TestReport, Turn, UserTurn } from "./protocol";
import { stripReportFence } from "./report";

interface Discipline {
  id: string;
  slash: string;
  title: string;
  description: string;
  enabled: boolean;
}

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
const disciplines = JSON.parse(document.getElementById("disciplines")?.textContent || "[]") as Discipline[];

const transcript = mustGet("transcript");
const draft = mustGet("draft") as HTMLTextAreaElement;
const plus = mustGet("plus") as HTMLButtonElement;
const menu = mustGet("menu");
const chips = mustGet("chips");
const hint = mustGet("hint");
const send = mustGet("send") as HTMLButtonElement;
const composer = mustGet("composer");
const notice = mustGet("notice");
const keybar = mustGet("keybar");
const workspacePill = mustGet("workspace-pill");
const sandboxPill = mustGet("sandbox-pill");
const progress = mustGet("progress");
const agentName = mustGet("agent-name");
const newSession = mustGet("new-session");
const openEnv = mustGet("open-env");

const SUGGESTIONS = [
  {
    title: "Walk the main path",
    detail: "The behavior a person hits first, including the success.",
    prompt: "Walk the main user path. Verify the behavior a person would hit first, including what happens when it succeeds.",
  },
  {
    title: "Invalid input and missing data",
    detail: "Empty values, bad input, and the failure paths.",
    prompt: "Focus on invalid input, empty values, and missing data. I want the failure paths, not the happy path.",
  },
  {
    title: "Run what exists, then the gaps",
    detail: "Start from the current tests and cover what they skip.",
    prompt: "Run the tests that already exist. Then add functional checks for important behavior they do not cover.",
  },
];

let workspaceName: string | null = null;
let fileCount = -1;
let hasKey = false;
let sandboxLabel = "No sandbox";
let running = false;
let hasTurns = false;
let disciplineId: string | null = null;
let menuOpen = false;
let slashMode = false;
let activeIndex = 0;
let stick = true;
let currentAgent: HTMLElement | null = null;
let noticeTimer = 0;

restoreDraft();
renderChip();
refreshComposer();
renderEmpty();
window.addEventListener("message", (event: MessageEvent<HostToWebview>) => {
  if (!event.data || typeof event.data !== "object" || !("type" in event.data)) {
    return;
  }
  apply(event.data);
});
vscode.postMessage({ type: "ready" });

draft.addEventListener("input", () => {
  resize();
  saveDraft();
  refreshComposer();
  if (/^\/[^\n]*$/.test(draft.value)) {
    openMenu(true);
  } else if (slashMode) {
    closeMenu();
  }
});

draft.addEventListener("keydown", (event) => {
  if (menuOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    event.preventDefault();
    moveActive(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key === "Escape" && menuOpen) {
    event.preventDefault();
    closeMenu();
    return;
  }
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    if (menuOpen) {
      const item = filtered()[activeIndex];
      if (item) {
        choose(item);
      }
      return;
    }
    submit();
  }
});

plus.addEventListener("click", () => {
  if (running) {
    return;
  }
  if (menuOpen && !slashMode) {
    closeMenu();
    return;
  }
  openMenu(false);
});

composer.addEventListener("submit", (event) => {
  event.preventDefault();
  submit();
});

document.addEventListener("mousedown", (event) => {
  if (!menuOpen) {
    return;
  }
  const target = event.target as Node;
  if (!menu.contains(target) && target !== plus) {
    closeMenu();
  }
});

newSession.addEventListener("click", () => {
  vscode.postMessage({ type: "newSession" });
});

openEnv.addEventListener("click", () => {
  vscode.postMessage({ type: "openEnv" });
});

transcript.addEventListener("scroll", () => {
  stick = transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight < 90;
});

window.setInterval(() => {
  document.querySelectorAll<HTMLElement>(".turn.agent[data-live='true']").forEach((node) => {
    const started = Number(node.dataset.started || Date.now());
    const label = node.querySelector(".elapsed");
    if (label) {
      label.textContent = formatElapsed(Date.now() - started);
    }
  });
}, 1000);

function apply(message: HostToWebview): void {
  switch (message.type) {
    case "init":
      agentName.textContent = message.agent;
      applyStatus(message);
      break;
    case "status":
      applyStatus(message);
      break;
    case "snapshot":
      renderSnapshot(message.snapshot.turns, message.snapshot.running);
      sandboxLabel = message.snapshot.sandboxLabel;
      paintPills();
      break;
    case "run-start":
      ensureTranscript();
      appendUser(message.turn);
      currentAgent = appendAgent({
        role: "agent",
        phase: "Reading the open folder",
        activities: [],
        answer: "",
        startedAt: Date.now(),
      });
      running = true;
      refreshComposer();
      forceStick();
      break;
    case "sync": {
      const users = transcript.querySelectorAll(".turn.user");
      const sync = users[users.length - 1]?.querySelector(".sync");
      if (sync) {
        sync.textContent = message.label;
      }
      break;
    }
    case "phase":
      setPhase(message.label);
      break;
    case "activity":
      upsertActivity(message.item);
      break;
    case "answer":
      setAnswer(message.text);
      break;
    case "report":
      setReport(message.report);
      break;
    case "run-end":
      finish(message.endedAt, message.usage);
      break;
    case "run-error":
      fail(message.message, message.endedAt);
      break;
    case "notice":
      showNotice(message.message);
      running = false;
      refreshComposer();
      break;
    default:
      break;
  }
}

function applyStatus(message: { workspaceName: string | null; fileCount: number; hasKey: boolean; sandboxLabel: string }): void {
  workspaceName = message.workspaceName;
  fileCount = message.fileCount;
  hasKey = message.hasKey;
  sandboxLabel = message.sandboxLabel;
  keybar.hidden = hasKey;
  paintPills();
  if (!hasTurns) {
    renderEmpty();
  }
  refreshComposer();
}

function paintPills(): void {
  workspacePill.textContent = workspaceName ?? "No folder open";
  sandboxPill.textContent = sandboxLabel;
  sandboxPill.classList.toggle("live", sandboxLabel !== "No sandbox");
  progress.classList.toggle("on", running || sandboxLabel === "Sandbox running");
}

function renderSnapshot(turns: Turn[], isRunning: boolean): void {
  transcript.replaceChildren();
  currentAgent = null;
  hasTurns = turns.length > 0;
  running = isRunning;
  if (!hasTurns) {
    renderEmpty();
  }
  for (const turn of turns) {
    if (turn.role === "user") {
      appendUser(turn);
    } else {
      currentAgent = appendAgent(turn);
    }
  }
  if (currentAgent && !isRunning) {
    currentAgent.dataset.live = "false";
    currentAgent.querySelector(".prose")?.classList.remove("streaming");
  }
  refreshComposer();
  forceStick();
}

function renderEmpty(): void {
  transcript.replaceChildren();
  hasTurns = false;
  const root = document.createElement("section");
  root.className = "empty";
  const title = document.createElement("h2");
  title.textContent = "What should we verify?";
  const lede = document.createElement("p");
  lede.className = "lede";
  lede.textContent = "Functional testing for the folder you have open. Verity designs cases from the real behavior, runs them in a sandbox, and shows what passed, failed, or could not be executed.";
  const count = document.createElement("p");
  count.className = "count";
  count.textContent = folderLine();
  const list = document.createElement("div");
  list.className = "suggestions";
  for (const suggestion of SUGGESTIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion";
    const strong = document.createElement("strong");
    strong.textContent = suggestion.title;
    const detail = document.createElement("span");
    detail.textContent = suggestion.detail;
    button.append(strong, detail);
    button.addEventListener("click", () => {
      const functional = disciplines.find((item) => item.id === "functional");
      if (functional) {
        disciplineId = functional.id;
      }
      draft.value = suggestion.prompt;
      renderChip();
      resize();
      saveDraft();
      refreshComposer();
      draft.focus();
    });
    list.append(button);
  }
  root.append(title, lede, count, list);
  transcript.append(root);
}

function folderLine(): string {
  if (!workspaceName) {
    return "Open a folder to give Verity something to test.";
  }
  if (fileCount < 0) {
    return `Looking through ${workspaceName}…`;
  }
  if (fileCount === 0) {
    return `${workspaceName} has no source files Verity can read.`;
  }
  const noun = fileCount === 1 ? "source file" : "source files";
  return `${fileCount} ${noun} in ${workspaceName} are ready to test.`;
}

function ensureTranscript(): void {
  if (!hasTurns) {
    transcript.replaceChildren();
    hasTurns = true;
  }
}

function appendUser(turn: UserTurn): HTMLElement {
  const article = document.createElement("article");
  article.className = "turn user";
  const head = document.createElement("header");
  head.className = "turn-head";
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = "You";
  head.append(who);
  article.append(head, chipElement(turn.disciplineLabel, false));
  if (turn.prompt) {
    const ask = document.createElement("p");
    ask.className = "ask";
    ask.textContent = turn.prompt;
    article.append(ask);
  } else {
    const ask = document.createElement("p");
    ask.className = "ask";
    ask.textContent = "Full functional pass on this folder.";
    article.append(ask);
  }
  const sync = document.createElement("p");
  sync.className = "sync";
  sync.textContent = turn.syncLabel;
  article.append(sync);
  transcript.append(article);
  return article;
}

function appendAgent(turn: AgentTurn): HTMLElement {
  const article = document.createElement("article");
  article.className = "turn agent";
  article.dataset.started = String(turn.startedAt);
  article.dataset.live = turn.endedAt ? "false" : "true";
  const head = document.createElement("header");
  head.className = "turn-head";
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = "Verity";
  const elapsed = document.createElement("span");
  elapsed.className = "elapsed";
  elapsed.textContent = formatElapsed((turn.endedAt ?? Date.now()) - turn.startedAt);
  head.append(who, elapsed);
  const phase = document.createElement("p");
  phase.className = "phase";
  const dot = document.createElement("i");
  dot.className = "dot";
  const phaseText = document.createElement("span");
  phaseText.className = "phase-text";
  phaseText.textContent = turn.phase;
  phase.append(dot, phaseText);
  const activity = document.createElement("ol");
  activity.className = "activity";
  const prose = document.createElement("div");
  prose.className = "prose";
  if (!turn.endedAt) {
    prose.classList.add("streaming");
  }
  const pending = document.createElement("p");
  pending.className = "pending";
  pending.hidden = true;
  pending.textContent = "Assembling findings";
  const report = document.createElement("section");
  report.className = "report";
  report.hidden = true;
  const usage = document.createElement("p");
  usage.className = "usage";
  usage.hidden = true;
  const error = document.createElement("p");
  error.className = "error";
  error.hidden = true;
  article.append(head, phase, activity, prose, pending, report, usage, error);
  transcript.append(article);
  paintPhase(article, turn.phase);
  for (const item of turn.activities) {
    activity.append(activityNode(item));
  }
  if (turn.answer) {
    writeAnswer(article, turn.answer);
  }
  if (turn.report) {
    writeReport(article, turn.report);
  }
  if (turn.usage) {
    usage.hidden = false;
    usage.textContent = turn.usage;
  }
  if (turn.error) {
    error.hidden = false;
    error.textContent = turn.error;
  }
  return article;
}

function setPhase(label: string): void {
  if (!currentAgent) {
    return;
  }
  paintPhase(currentAgent, label);
  const text = currentAgent.querySelector(".phase-text");
  if (text) {
    text.textContent = label;
  }
  maybeStick();
}

function paintPhase(article: HTMLElement, label: string): void {
  const phase = article.querySelector(".phase");
  if (!phase) {
    return;
  }
  const quiet = /finished|stopped|timed out|could not finish/i.test(label);
  phase.classList.toggle("quiet", quiet);
}

function upsertActivity(item: ActivityItem): void {
  if (!currentAgent) {
    return;
  }
  const list = currentAgent.querySelector(".activity");
  if (!list) {
    return;
  }
  const existing = list.querySelector<HTMLElement>(`[data-id="${cssEscape(item.id)}"]`);
  const node = activityNode(item);
  if (existing) {
    existing.replaceWith(node);
  } else {
    list.append(node);
  }
  maybeStick();
}

function activityNode(item: ActivityItem): HTMLLIElement {
  const li = document.createElement("li");
  li.dataset.id = item.id;
  li.className = item.kind === "thought" ? "thought" : "tool";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent = item.kind === "thought" ? "Reasoning" : item.title;
  li.append(title);
  if (item.kind === "tool" && item.body) {
    const body = document.createElement("div");
    body.className = "body";
    body.textContent = item.body;
    li.append(body);
  }
  return li;
}

function setAnswer(text: string): void {
  if (!currentAgent) {
    return;
  }
  writeAnswer(currentAgent, text);
  maybeStick();
}

function writeAnswer(article: HTMLElement, text: string): void {
  const prose = article.querySelector(".prose");
  const pending = article.querySelector(".pending") as HTMLElement | null;
  if (!prose) {
    return;
  }
  const split = stripReportFence(text);
  prose.innerHTML = renderMarkdown(split.prose);
  if (pending) {
    pending.hidden = !split.pending;
  }
}

function setReport(report: TestReport): void {
  if (!currentAgent) {
    return;
  }
  writeReport(currentAgent, report);
  const pending = currentAgent.querySelector(".pending") as HTMLElement | null;
  if (pending) {
    pending.hidden = true;
  }
  maybeStick();
}

function writeReport(article: HTMLElement, report: TestReport): void {
  const host = article.querySelector(".report") as HTMLElement | null;
  if (!host) {
    return;
  }
  host.hidden = false;
  host.replaceChildren();
  const counts = { pass: 0, fail: 0, blocked: 0 };
  for (const testCase of report.cases) {
    counts[testCase.status] += 1;
  }
  const score = document.createElement("div");
  score.className = "score";
  score.append(scoreItem("pass", counts.pass, "passed"), scoreItem("fail", counts.fail, "failed"), scoreItem("blocked", counts.blocked, "blocked"));
  host.append(score);
  if (report.summary) {
    const summary = document.createElement("p");
    summary.className = "summary";
    summary.textContent = report.summary;
    host.append(summary);
  }
  const cases = document.createElement("div");
  cases.className = "cases";
  for (const testCase of report.cases) {
    const card = document.createElement("article");
    card.className = `case ${testCase.status}`;
    const top = document.createElement("div");
    top.className = "case-top";
    const id = document.createElement("span");
    id.className = "case-id";
    id.textContent = testCase.id;
    const status = document.createElement("span");
    status.className = "case-status";
    status.textContent = testCase.status === "pass" ? "Passed" : testCase.status === "fail" ? "Failed" : "Blocked";
    top.append(id, status);
    const title = document.createElement("h3");
    title.className = "case-title";
    title.textContent = testCase.title;
    card.append(top, title);
    const pair = document.createElement("dl");
    pair.className = "pair";
    pair.append(pairRow("Expected", testCase.expected), pairRow("Actual", testCase.actual));
    card.append(pair);
    if (testCase.evidence) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Evidence";
      const evidence = document.createElement("pre");
      evidence.className = "evidence";
      evidence.textContent = testCase.evidence;
      details.append(summary, evidence);
      card.append(details);
    }
    cases.append(card);
  }
  host.append(cases);
}

function scoreItem(kind: string, count: number, label: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = kind;
  span.textContent = `${count} ${label}`;
  return span;
}

function pairRow(label: string, value: string): HTMLDivElement {
  const row = document.createElement("div");
  const dt = document.createElement("dt");
  dt.textContent = label;
  const dd = document.createElement("dd");
  dd.textContent = value || "—";
  row.append(dt, dd);
  return row;
}

function finish(endedAt: number, usage?: string): void {
  running = false;
  if (currentAgent) {
    currentAgent.dataset.live = "false";
    currentAgent.querySelector(".prose")?.classList.remove("streaming");
    const elapsed = currentAgent.querySelector(".elapsed");
    const started = Number(currentAgent.dataset.started || endedAt);
    if (elapsed) {
      elapsed.textContent = formatElapsed(endedAt - started);
    }
    if (usage) {
      const node = currentAgent.querySelector(".usage") as HTMLElement | null;
      if (node) {
        node.hidden = false;
        node.textContent = usage;
      }
    }
  }
  refreshComposer();
  maybeStick();
}

function fail(message: string, endedAt: number): void {
  running = false;
  if (currentAgent) {
    currentAgent.dataset.live = "false";
    currentAgent.querySelector(".prose")?.classList.remove("streaming");
    const error = currentAgent.querySelector(".error") as HTMLElement | null;
    if (error) {
      error.hidden = false;
      error.textContent = message;
    }
    const elapsed = currentAgent.querySelector(".elapsed");
    const started = Number(currentAgent.dataset.started || endedAt);
    if (elapsed) {
      elapsed.textContent = formatElapsed(endedAt - started);
    }
  } else {
    showNotice(message);
  }
  refreshComposer();
}

function submit(): void {
  if (running) {
    vscode.postMessage({ type: "cancel" });
    return;
  }
  if (!disciplineId) {
    openMenu(false);
    showNotice("Select Functional Testing to run this.");
    return;
  }
  const prompt = draft.value.trim();
  draft.value = "";
  resize();
  saveDraft();
  running = true;
  refreshComposer();
  vscode.postMessage({ type: "send", discipline: disciplineId, prompt });
}

function openMenu(fromSlash: boolean): void {
  slashMode = fromSlash;
  menuOpen = true;
  activeIndex = Math.max(0, filtered().findIndex((item) => item.enabled));
  renderMenu();
  menu.hidden = false;
  plus.setAttribute("aria-expanded", "true");
}

function closeMenu(): void {
  menuOpen = false;
  slashMode = false;
  menu.hidden = true;
  plus.setAttribute("aria-expanded", "false");
}

function renderMenu(): void {
  menu.replaceChildren();
  const label = document.createElement("p");
  label.className = "menu-label";
  label.textContent = "Testing disciplines";
  menu.append(label);
  const items = filtered();
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "menu-desc";
    empty.textContent = "No discipline matches that.";
    empty.style.padding = "8px 10px 10px";
    menu.append(empty);
    return;
  }
  items.forEach((item, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "menu-item";
    button.setAttribute("role", "menuitem");
    if (index === activeIndex) {
      button.classList.add("is-current");
    }
    const copy = document.createElement("span");
    const title = document.createElement("span");
    title.className = "menu-title";
    title.textContent = item.title;
    const desc = document.createElement("span");
    desc.className = "menu-desc";
    desc.textContent = item.description;
    copy.append(title, desc);
    const badge = document.createElement("span");
    badge.className = item.enabled ? "badge ready" : "badge";
    badge.textContent = item.enabled ? "Ready" : "Soon";
    button.append(copy, badge);
    button.addEventListener("click", () => choose(item));
    menu.append(button);
  });
  menu.querySelector(".is-current")?.scrollIntoView({ block: "nearest" });
}

function filtered(): Discipline[] {
  if (!slashMode) {
    return disciplines;
  }
  const query = draft.value.replace(/^\//, "").trim().toLowerCase();
  if (!query) {
    return disciplines;
  }
  return disciplines.filter((item) => `${item.title} ${item.slash}`.toLowerCase().includes(query));
}

function moveActive(delta: number): void {
  const items = filtered();
  if (!items.length) {
    return;
  }
  activeIndex = (activeIndex + delta + items.length) % items.length;
  renderMenu();
}

function choose(item: Discipline): void {
  if (!item.enabled) {
    showNotice(`${item.title} is not in this build. Functional Testing is ready.`);
    return;
  }
  disciplineId = item.id;
  if (/^\/[^\n]*$/.test(draft.value)) {
    draft.value = "";
  }
  closeMenu();
  renderChip();
  resize();
  saveDraft();
  refreshComposer();
  draft.focus();
}

function renderChip(): void {
  chips.replaceChildren();
  const discipline = disciplines.find((item) => item.id === disciplineId);
  if (!discipline) {
    return;
  }
  chips.append(chipElement(discipline.slash, true));
}

function chipElement(slashLabel: string, removable: boolean): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = "chip";
  const slash = document.createElement("span");
  slash.className = "slash";
  slash.textContent = "/";
  const name = slashLabel.replace(/^\//, "");
  chip.append(slash, document.createTextNode(name));
  if (removable) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "chip-x";
    remove.setAttribute("aria-label", `Remove ${name}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      disciplineId = null;
      renderChip();
      saveDraft();
      refreshComposer();
    });
    chip.append(remove);
  }
  return chip;
}

function refreshComposer(): void {
  const discipline = disciplines.find((item) => item.id === disciplineId);
  draft.placeholder = discipline
    ? "Add a focus, or send Functional Testing on its own"
    : "Ask Verity to test this project";
  composer.classList.toggle("is-running", running);
  send.classList.toggle("is-stop", running);
  send.disabled = !running && !discipline;
  send.setAttribute("aria-label", running ? "Stop" : "Send");
  if (running) {
    hint.textContent = "Running in the sandbox";
    return;
  }
  if (!discipline) {
    hint.textContent = "Use + to choose a discipline";
    return;
  }
  hint.textContent = draft.value.trim()
    ? "Enter to send · Shift+Enter for a new line"
    : "Enter sends Functional Testing across this folder";
}

function showNotice(message: string): void {
  notice.hidden = false;
  notice.textContent = message;
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => {
    notice.hidden = true;
  }, 7000);
}

function resize(): void {
  draft.style.height = "auto";
  draft.style.height = `${Math.min(draft.scrollHeight, 140)}px`;
}

function saveDraft(): void {
  vscode.setState({ disciplineId, draft: draft.value });
}

function restoreDraft(): void {
  const state = vscode.getState() as { disciplineId?: string; draft?: string } | null;
  if (!state) {
    return;
  }
  if (state.disciplineId && disciplines.some((item) => item.id === state.disciplineId && item.enabled)) {
    disciplineId = state.disciplineId;
  }
  if (typeof state.draft === "string") {
    draft.value = state.draft;
    resize();
  }
}

function maybeStick(): void {
  if (stick) {
    transcript.scrollTop = transcript.scrollHeight;
  }
}

function forceStick(): void {
  stick = true;
  transcript.scrollTop = transcript.scrollHeight;
}

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, "");
}

function mustGet(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing #${id}`);
  }
  return node;
}
