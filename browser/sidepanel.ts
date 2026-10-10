import { DISCIPLINES } from "../src/disciplines";
import { buildReportPdf, reportFileName } from "../src/reportPdf";
import type { TestReport } from "../src/protocol";

const host = document.querySelector("#host") as HTMLElement;
const bridge = document.querySelector("#bridge") as HTMLElement;
const transcript = document.querySelector("#transcript") as HTMLElement;
const composer = document.querySelector("#composer") as HTMLFormElement;
const notice = document.querySelector("#notice") as HTMLElement;
const menu = document.querySelector("#menu") as HTMLElement;
const chips = document.querySelector("#chips") as HTMLElement;
const draft = document.querySelector("#draft") as HTMLTextAreaElement;
const plus = document.querySelector("#plus") as HTMLButtonElement;
const hint = document.querySelector("#hint") as HTMLElement;
const send = document.querySelector("#send") as HTMLButtonElement;
const fresh = document.querySelector("#fresh") as HTMLButtonElement;

const hints: Record<string, string> = {
  functional: "Moves through this page and checks what a person can do.",
  api: "Calls the APIs this page uses and compares the response.",
  security: "Reviews inputs and protections, then says how to prevent each gap.",
};

let discipline = "functional";
let running = false;

void boot();

function boot(): void {
  renderMenu();
  renderChip();
  renderEmpty();
  void refreshStatus();
  plus.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
  });
  fresh.addEventListener("click", () => {
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
    menu.hidden = true;
    void start();
  });
  chrome.runtime.onMessage.addListener((message: { type?: string }) => {
    if (message.type === "status") {
      paintStatus(message as { host: string | null; composer: boolean });
    }
    if (message.type === "phase") {
      paintPhase((message as { label: string }).label);
    }
    if (message.type === "report") {
      running = false;
      send.disabled = false;
      send.textContent = "Check";
      const payload = message as {
        report: TestReport;
        notes?: string[];
        discipline: string;
        project: string;
        focus: string;
      };
      paintReport(payload.report, payload.notes || [], payload.discipline, payload.project, payload.focus);
    }
    if (message.type === "error") {
      running = false;
      send.disabled = false;
      send.textContent = "Check";
      notice.hidden = false;
      notice.textContent = (message as { message: string }).message;
    }
  });
}

async function refreshStatus(): Promise<void> {
  const status = (await chrome.runtime.sendMessage({ type: "status" })) as { host: string | null; composer: boolean } | undefined;
  if (status) {
    paintStatus(status);
  }
}

function paintStatus(status: { host: string | null; composer: boolean }): void {
  host.textContent = status.host || "Open a website";
  bridge.textContent = status.composer ? "Composer Fast ready" : "Checking this page directly";
}

function renderMenu(): void {
  menu.replaceChildren();
  for (const item of DISCIPLINES) {
    const button = document.createElement("button");
    button.type = "button";
    button.disabled = !item.enabled;
    const title = document.createElement("span");
    title.textContent = item.enabled ? item.title : `${item.title} · Soon`;
    const detail = document.createElement("small");
    detail.textContent = item.description;
    button.append(title, detail);
    button.addEventListener("click", () => {
      if (!item.enabled) {
        return;
      }
      discipline = item.id;
      menu.hidden = true;
      renderChip();
    });
    menu.append(button);
  }
}

function renderChip(): void {
  const selected = DISCIPLINES.find((item) => item.id === discipline);
  chips.replaceChildren();
  const chip = document.createElement("span");
  chip.className = "chip";
  chip.textContent = selected?.title || "Functional testing";
  chips.append(chip);
  hint.textContent = hints[discipline] || hints.functional;
}

function renderEmpty(): void {
  transcript.replaceChildren();
  const block = document.createElement("section");
  block.className = "empty";
  const title = document.createElement("h2");
  title.textContent = "Check the page you have open";
  const copy = document.createElement("p");
  copy.textContent = "Choose a test, add a note if you want one part looked at, then press Check. You can download the result when it is ready.";
  block.append(title, copy);
  transcript.append(block);
}

async function start(): Promise<void> {
  if (running) {
    return;
  }
  notice.hidden = true;
  running = true;
  send.disabled = true;
  send.textContent = "Checking";
  transcript.replaceChildren();
  paintPhase("Reading this page");
  await chrome.runtime.sendMessage({ type: "run", discipline, prompt: draft.value });
  draft.value = "";
}

function paintPhase(label: string): void {
  let phase = transcript.querySelector(".phase");
  if (!phase) {
    phase = document.createElement("p");
    phase.className = "phase";
    transcript.prepend(phase);
  }
  phase.textContent = label;
}

function paintReport(report: TestReport, notes: string[], disciplineId: string, project: string, focus: string): void {
  const phase = transcript.querySelector(".phase");
  phase?.remove();
  const card = document.createElement("article");
  card.className = "card";
  const counts = { pass: 0, fail: 0, blocked: 0 };
  for (const testCase of report.cases) {
    counts[testCase.status] += 1;
  }
  const bar = document.createElement("div");
  bar.className = "bar";
  const score = document.createElement("div");
  score.className = "score";
  score.append(scoreItem("pass", counts.pass, "passed"), scoreItem("fail", counts.fail, "failed"), scoreItem("blocked", counts.blocked, "blocked"));
  const download = document.createElement("button");
  download.type = "button";
  download.className = "download";
  download.textContent = "Download PDF";
  download.addEventListener("click", () => {
    void savePdf(report, disciplineId, project, focus);
  });
  bar.append(score, download);
  card.append(bar);
  if (report.summary) {
    const summary = document.createElement("p");
    summary.className = "summary";
    summary.textContent = report.summary;
    card.append(summary);
  }
  for (const testCase of report.cases) {
    const block = document.createElement("section");
    block.className = `case ${testCase.status}`;
    const top = document.createElement("div");
    top.className = "case-top";
    const id = document.createElement("span");
    id.textContent = testCase.id;
    const status = document.createElement("span");
    status.className = "status";
    status.textContent = testCase.status === "pass" ? "Passed" : testCase.status === "fail" ? "Failed" : "Blocked";
    top.append(id, status);
    const title = document.createElement("h3");
    title.textContent = testCase.title;
    block.append(top, title, field("Expected", testCase.expected), field("Found", testCase.actual));
    if (testCase.improvement) {
      const box = document.createElement("div");
      box.className = "improve";
      box.append(field(improveLabel(disciplineId), testCase.improvement));
      block.append(box);
    }
    if (testCase.evidence) {
      const evidence = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Evidence";
      evidence.append(summary, field("", testCase.evidence));
      block.append(evidence);
    }
    card.append(block);
  }
  if (notes.length) {
    const line = document.createElement("p");
    line.className = "notes";
    line.textContent = notes.join(" ");
    card.append(line);
  }
  transcript.append(card);
}

function improveLabel(disciplineId: string): string {
  if (disciplineId === "security") {
    return "How to prevent it";
  }
  if (disciplineId === "api") {
    return "What to change";
  }
  return "What to change";
}

function field(label: string, value: string): HTMLElement {
  const wrap = document.createElement("div");
  if (label) {
    const term = document.createElement("dt");
    term.textContent = label;
    wrap.append(term);
  }
  const dd = document.createElement("dd");
  dd.textContent = value;
  wrap.append(dd);
  return wrap;
}

function scoreItem(kind: string, count: number, label: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = kind;
  span.textContent = `${count} ${label}`;
  return span;
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
