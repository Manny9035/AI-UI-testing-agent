import { DISCIPLINES } from "../src/disciplines";
import { buildReportPdf, reportFileName } from "../src/reportPdf";
import type { TestReport } from "../src/protocol";

const host = document.querySelector("#host") as HTMLElement;
const transcript = document.querySelector("#transcript") as HTMLElement;
const composer = document.querySelector("#composer") as HTMLFormElement;
const notice = document.querySelector("#notice") as HTMLElement;
const draft = document.querySelector("#draft") as HTMLTextAreaElement;
const send = document.querySelector("#send") as HTMLButtonElement;
const fresh = document.querySelector("#fresh") as HTMLButtonElement;
const plus = document.querySelector("#plus") as HTMLButtonElement;
const menu = document.querySelector("#menu") as HTMLElement;
const chip = document.querySelector("#chip") as HTMLButtonElement;
const spinner = document.querySelector("#spinner") as HTMLElement;
const box = document.querySelector(".box") as HTMLElement;

const checks = DISCIPLINES.filter((item) => item.enabled);

const blurbs: Record<string, string> = {
  functional: "Walk the open page.",
  api: "Call the addresses on this page.",
  security: "Review inputs and protections.",
};

const stepsFor: Record<string, string[]> = {
  functional: ["Reading the code…", "Walking what a person can use", "Judging what holds"],
  api: ["Reading the code…", "Calling the addresses on this page", "Comparing the response"],
  security: ["Reading the code…", "Reviewing inputs and protections", "Naming how to prevent it"],
};

const stepMs = [5000, 7000, 5000];

let discipline = "functional";
let running = false;
let sequenceDone = false;
let pending: { report: TestReport; notes: string[]; discipline: string; project: string; focus: string } | null = null;
let view = 0;
let timers: number[] = [];

void boot();

function boot(): void {
  renderMenu();
  paintChip();
  renderEmpty();
  void refreshStatus();
  plus.addEventListener("click", () => {
    if (running) {
      return;
    }
    setMenuOpen(menu.hidden);
  });
  chip.addEventListener("click", () => {
    if (running) {
      return;
    }
    setMenuOpen(menu.hidden);
  });
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Node) || plus.contains(target) || chip.contains(target) || menu.contains(target)) {
      return;
    }
    setMenuOpen(false);
  });
  fresh.addEventListener("click", () => {
    if (running) {
      return;
    }
    notice.hidden = true;
    renderEmpty();
  });
  draft.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      composer.requestSubmit();
    }
  });
  composer.addEventListener("submit", (event) => {
    event.preventDefault();
    void start();
  });
  if (!hasChrome()) {
    return;
  }
  chrome.runtime.onMessage.addListener((message: { type?: string }) => {
    if (message.type === "status") {
      paintStatus(message as { host: string | null });
    }
    if (message.type === "report" && running) {
      const payload = message as {
        report: TestReport;
        notes?: string[];
        discipline: string;
        project: string;
        focus: string;
      };
      pending = {
        report: payload.report,
        notes: payload.notes || [],
        discipline: payload.discipline,
        project: payload.project,
        focus: payload.focus,
      };
      tryReveal();
    }
    if (message.type === "error" && running) {
      fail((message as { message: string }).message);
    }
  });
}

function hasChrome(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.sendMessage);
}

async function refreshStatus(): Promise<void> {
  if (!hasChrome()) {
    return;
  }
  const status = (await chrome.runtime.sendMessage({ type: "status" })) as { host: string | null } | undefined;
  if (status) {
    paintStatus(status);
  }
}

function paintStatus(status: { host: string | null }): void {
  host.textContent = status.host || "Open a website";
}

function renderMenu(): void {
  menu.replaceChildren();
  for (const item of checks) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.setAttribute("aria-current", item.id === discipline ? "true" : "false");
    const name = document.createElement("strong");
    name.textContent = item.title.replace(" Testing", "");
    const blurb = document.createElement("span");
    blurb.textContent = blurbs[item.id] || "";
    button.append(name, blurb);
    button.addEventListener("click", () => {
      discipline = item.id;
      paintChip();
      renderMenu();
      setMenuOpen(false);
    });
    menu.append(button);
  }
}

function paintChip(): void {
  const selected = checks.find((item) => item.id === discipline) || checks[0];
  chip.textContent = (selected?.title || "Functional Testing").replace(" Testing", "");
}

function setMenuOpen(open: boolean): void {
  menu.hidden = !open;
  plus.setAttribute("aria-expanded", open ? "true" : "false");
}

function renderEmpty(): void {
  view += 1;
  transcript.replaceChildren();
  const line = document.createElement("p");
  line.className = "empty";
  line.textContent = "Pick a check, then run it on this tab.";
  transcript.append(line);
}

async function start(): Promise<void> {
  if (running) {
    return;
  }
  if (!hasChrome()) {
    notice.hidden = false;
    notice.textContent = "Open this panel from the NextOps icon on a website.";
    return;
  }
  const prompt = draft.value.trim();
  beginRun(prompt);
  playSequence();
  try {
    await chrome.runtime.sendMessage({ type: "run", discipline, prompt });
  } catch {
    if (running) {
      fail("Could not finish this check.");
    }
  }
}

function beginRun(prompt: string): void {
  notice.hidden = true;
  setMenuOpen(false);
  running = true;
  sequenceDone = false;
  pending = null;
  view += 1;
  clearTimers();
  draft.value = "";
  draft.disabled = true;
  send.disabled = true;
  fresh.disabled = true;
  plus.disabled = true;
  chip.disabled = true;
  spinner.hidden = false;
  box.classList.add("is-busy");
  paintThread(prompt);
}

function paintThread(prompt: string): void {
  transcript.replaceChildren();
  const thread = document.createElement("div");
  thread.className = "thread";
  const request = document.createElement("article");
  request.className = "request";
  const who = document.createElement("p");
  who.className = "who";
  who.textContent = chip.textContent || "Functional";
  const text = document.createElement("p");
  text.textContent = prompt || "Check this page.";
  request.append(who, text);
  const list = document.createElement("ol");
  list.className = "steps";
  thread.append(request, list);
  transcript.append(thread);
  transcript.scrollTop = 0;
}

function playSequence(): void {
  const lines = stepsFor[discipline] || stepsFor.functional;
  const token = view;
  let elapsed = 0;
  lines.forEach((line, index) => {
    const at = elapsed;
    later(at, () => {
      if (token !== view) {
        return;
      }
      showStep(line);
    });
    elapsed += stepMs[index] || 5000;
  });
  later(elapsed, () => {
    if (token !== view) {
      return;
    }
    sequenceDone = true;
    if (!pending) {
      const active = transcript.querySelector(".step.active span");
      if (active) {
        active.textContent = "Writing the handoff…";
      }
      draft.placeholder = "Writing the handoff…";
      transcript.querySelector(".step.active")?.classList.add("hold");
    }
    tryReveal();
  });
}

function showStep(label: string): void {
  const list = transcript.querySelector(".steps");
  if (!list) {
    return;
  }
  const previous = list.querySelector(".step.active");
  if (previous) {
    previous.classList.remove("active");
    previous.classList.add("done");
  }
  const item = document.createElement("li");
  item.className = "step active";
  const mark = document.createElement("i");
  const text = document.createElement("span");
  text.textContent = label;
  item.append(mark, text);
  list.append(item);
  draft.placeholder = label;
  item.scrollIntoView({ block: "nearest" });
}

function tryReveal(): void {
  if (!running || !sequenceDone || !pending) {
    return;
  }
  const payload = pending;
  pending = null;
  finishRun();
  revealReport(payload.report, payload.discipline, payload.project, payload.focus);
}

function fail(message: string): void {
  clearTimers();
  finishRun();
  notice.hidden = false;
  notice.textContent = message;
  transcript.querySelector(".steps")?.remove();
}

function finishRun(): void {
  running = false;
  sequenceDone = false;
  draft.disabled = false;
  draft.placeholder = "Anything specific to look at?";
  send.disabled = false;
  fresh.disabled = false;
  plus.disabled = false;
  chip.disabled = false;
  spinner.hidden = true;
  box.classList.remove("is-busy");
}

function revealReport(report: TestReport, disciplineId: string, project: string, focus: string): void {
  transcript.querySelector(".steps")?.remove();
  const result = document.createElement("section");
  result.className = "result";
  const counts = { pass: 0, fail: 0, blocked: 0 };
  for (const testCase of report.cases) {
    counts[testCase.status] += 1;
  }
  const tone = counts.fail > 0 ? "fail" : counts.blocked > 0 ? "blocked" : "pass";
  const verdict = document.createElement("p");
  verdict.className = `verdict ${tone}`;
  verdict.textContent =
    tone === "fail" ? "Hand this back. The change is named." : tone === "blocked" ? "Part of this tab could not be judged." : "Ready to hand over.";
  const stats = document.createElement("div");
  stats.className = "stats";
  stats.append(stat("pass", counts.pass, "Passed"), stat("fail", counts.fail, "Failed"), stat("blocked", counts.blocked, "Blocked"));
  const findings = document.createElement("div");
  findings.className = "findings";
  report.cases.forEach((testCase, index) => {
    const card = findingCard(testCase, disciplineId);
    card.style.animationDelay = `${Math.min(index, 6) * 70}ms`;
    findings.append(card);
  });
  const download = document.createElement("button");
  download.type = "button";
  download.className = "download";
  download.textContent = "Download PDF";
  download.addEventListener("click", () => {
    void savePdf(report, disciplineId, project, focus);
  });
  result.append(verdict, stats, findings, download);
  const thread = transcript.querySelector(".thread");
  if (thread) {
    thread.append(result);
  } else {
    transcript.replaceChildren(result);
  }
  host.textContent = project || host.textContent;
  transcript.scrollTop = 0;
}

function findingCard(testCase: TestReport["cases"][number], disciplineId: string): HTMLElement {
  const block = document.createElement("details");
  block.className = `finding ${testCase.status}`;
  const summary = document.createElement("summary");
  const title = document.createElement("h3");
  title.textContent = testCase.title;
  const pill = document.createElement("span");
  pill.className = "pill";
  pill.textContent = testCase.status === "pass" ? "Passed" : testCase.status === "fail" ? "Failed" : "Blocked";
  summary.append(title, pill);
  const body = document.createElement("div");
  body.className = "body";
  const labels = fieldLabels(disciplineId);
  body.append(field(labels[0], testCase.expected), field(labels[1], testCase.actual));
  if (testCase.improvement) {
    const change = document.createElement("div");
    change.className = "improve";
    change.append(field(improveLabel(disciplineId), testCase.improvement));
    body.append(change);
  }
  if (testCase.evidence) {
    body.append(field("Evidence", testCase.evidence));
  }
  block.append(summary, body);
  return block;
}

function fieldLabels(disciplineId: string): [string, string] {
  if (disciplineId === "api") {
    return ["What the page expects", "What came back"];
  }
  if (disciplineId === "security") {
    return ["Protection that should exist", "What this page does"];
  }
  return ["Expected", "Observed"];
}

function improveLabel(disciplineId: string): string {
  return disciplineId === "security" ? "How to prevent it" : "What to change";
}

function field(label: string, value: string): HTMLElement {
  const wrap = document.createElement("div");
  const term = document.createElement("dt");
  term.textContent = label;
  const detail = document.createElement("dd");
  detail.textContent = value;
  wrap.append(term, detail);
  return wrap;
}

function stat(kind: string, count: number, label: string): HTMLElement {
  const card = document.createElement("article");
  card.className = `stat ${kind}`;
  const name = document.createElement("p");
  name.textContent = label;
  const value = document.createElement("strong");
  value.textContent = String(count);
  card.append(name, value);
  return card;
}

async function savePdf(report: TestReport, disciplineId: string, project: string, focus: string): Promise<void> {
  const selected = DISCIPLINES.find((item) => item.id === disciplineId);
  const generatedAt = Date.now();
  const bytes = await buildReportPdf({
    project,
    discipline: selected?.title || "Testing",
    focus,
    generatedAt,
    report,
  });
  const blob = new Blob([Uint8Array.from(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = reportFileName(selected?.title || "Testing", generatedAt);
  link.click();
  URL.revokeObjectURL(url);
}

function later(ms: number, run: () => void): void {
  const id = window.setTimeout(() => {
    timers = timers.filter((item) => item !== id);
    run();
  }, ms);
  timers.push(id);
}

function clearTimers(): void {
  for (const id of timers) {
    window.clearTimeout(id);
  }
  timers = [];
}
