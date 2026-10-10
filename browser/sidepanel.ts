import { DISCIPLINES } from "../src/disciplines";
import { buildReportPdf, reportFileName } from "../src/reportPdf";
import type { TestReport } from "../src/protocol";

const host = document.querySelector("#host") as HTMLElement;
const bridge = document.querySelector("#bridge") as HTMLElement;
const nav = document.querySelector("#nav") as HTMLElement;
const meaning = document.querySelector("#meaning") as HTMLElement;
const transcript = document.querySelector("#transcript") as HTMLElement;
const composer = document.querySelector("#composer") as HTMLFormElement;
const notice = document.querySelector("#notice") as HTMLElement;
const draft = document.querySelector("#draft") as HTMLTextAreaElement;
const hint = document.querySelector("#hint") as HTMLElement;
const send = document.querySelector("#send") as HTMLButtonElement;
const fresh = document.querySelector("#fresh") as HTMLButtonElement;
const scan = document.querySelector("#scan") as HTMLElement;

const meanings: Record<string, string> = {
  functional: "Walk what a person sees. Pass holds. Fail names the change. Blocked could not be judged.",
  api: "Call the addresses this page uses, then name the change that makes the page and the response agree.",
  security: "Review inputs and protections, then say how to prevent each gap.",
};

const hints: Record<string, string> = {
  functional: "Optional. Name one flow to stay inside.",
  api: "Optional. Name one endpoint to stay inside.",
  security: "Optional. Name one form or input to stay inside.",
};

let discipline = "functional";
let running = false;
let steps: string[] = [];

void boot();

function boot(): void {
  renderNav();
  paintMeaning();
  renderEmpty();
  void refreshStatus();
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
      paintStatus(message as { host: string | null; composer: boolean });
    }
    if (message.type === "phase") {
      paintPhase((message as { label: string }).label);
    }
    if (message.type === "report") {
      finishRun();
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
      finishRun();
      notice.hidden = false;
      notice.textContent = (message as { message: string }).message;
      renderEmpty();
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
  const status = (await chrome.runtime.sendMessage({ type: "status" })) as { host: string | null; composer: boolean } | undefined;
  if (status) {
    paintStatus(status);
  }
}

function paintStatus(status: { host: string | null; composer: boolean }): void {
  host.textContent = status.host || "Open a website";
  bridge.textContent = status.composer ? "Composer Fast is ready to write the handoff" : "This check runs on the open tab";
}

function renderNav(): void {
  nav.replaceChildren();
  const rail = document.createElement("div");
  rail.className = "rail";
  const later: string[] = [];
  for (const item of DISCIPLINES) {
    const name = item.title.replace(" Testing", "");
    if (!item.enabled) {
      later.push(name);
      continue;
    }
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-current", item.id === discipline ? "true" : "false");
    const mark = document.createElement("span");
    mark.className = "mark";
    mark.append(icon(item.id));
    const label = document.createElement("span");
    label.textContent = name;
    button.append(mark, label);
    button.addEventListener("click", () => {
      if (running) {
        return;
      }
      discipline = item.id;
      renderNav();
      paintMeaning();
    });
    rail.append(button);
  }
  const planned = document.createElement("p");
  planned.className = "planned";
  planned.textContent = `Coming later: ${later.join(" · ")}`;
  nav.append(rail, planned);
}

function paintMeaning(): void {
  meaning.textContent = meanings[discipline] || meanings.functional;
  hint.textContent = hints[discipline] || hints.functional;
}

function renderEmpty(): void {
  transcript.replaceChildren();
  const hero = document.createElement("section");
  hero.className = "hero";
  const kicker = document.createElement("p");
  kicker.className = "kicker";
  kicker.textContent = "This tab";
  const title = document.createElement("h2");
  title.textContent = "See what holds, what fails, and what to hand over.";
  const copy = document.createElement("p");
  copy.textContent = "Verity reads the tab you already have open, then writes a result a tester can hand over.";
  const promise = document.createElement("div");
  promise.className = "promise";
  for (const line of [
    ["pass", "Passed", "It holds."],
    ["fail", "Failed", "Name the change."],
    ["blocked", "Blocked", "Could not judge."],
  ]) {
    const card = document.createElement("div");
    card.className = line[0];
    const dot = document.createElement("i");
    const strong = document.createElement("strong");
    strong.textContent = line[1];
    const span = document.createElement("span");
    span.textContent = line[2];
    card.append(dot, strong, span);
    promise.append(card);
  }
  hero.append(kicker, title, copy, promise);
  transcript.append(hero);
}

async function start(): Promise<void> {
  if (running) {
    return;
  }
  if (!hasChrome()) {
    notice.hidden = false;
    notice.textContent = "Open this panel from the Verity icon on a website.";
    return;
  }
  notice.hidden = true;
  running = true;
  send.disabled = true;
  fresh.disabled = true;
  send.textContent = "Checking";
  document.body.classList.add("is-running");
  scan.hidden = false;
  steps = [];
  paintPhase("Reading this page");
  await chrome.runtime.sendMessage({ type: "run", discipline, prompt: draft.value });
  draft.value = "";
}

function finishRun(): void {
  running = false;
  send.disabled = false;
  fresh.disabled = false;
  send.textContent = "Check this page";
  document.body.classList.remove("is-running");
  scan.hidden = true;
}

function paintPhase(label: string): void {
  if (!steps.includes(label)) {
    steps.push(label);
  }
  let live = transcript.querySelector(".live") as HTMLElement | null;
  if (!live) {
    transcript.replaceChildren();
    live = document.createElement("section");
    live.className = "live";
    const head = document.createElement("div");
    head.className = "live-head";
    const dot = document.createElement("span");
    dot.className = "pulse";
    const text = document.createElement("div");
    const kicker = document.createElement("p");
    kicker.className = "kicker";
    kicker.textContent = "In progress";
    const title = document.createElement("h2");
    title.id = "live-title";
    text.append(kicker, title);
    head.append(dot, text);
    const list = document.createElement("ol");
    list.className = "steps";
    const stage = document.createElement("div");
    stage.className = "stage";
    stage.setAttribute("aria-hidden", "true");
    const frame = document.createElement("div");
    frame.className = "frame";
    for (const width of ["", "short", "", "short"]) {
      const line = document.createElement("div");
      line.className = width ? `frame-line ${width}` : "frame-line";
      frame.append(line);
    }
    const beam = document.createElement("div");
    beam.className = "beam";
    stage.append(frame, beam);
    const ghosts = document.createElement("div");
    ghosts.className = "stats ghost-stats";
    ghosts.append(ghost(), ghost(), ghost());
    live.append(head, list, stage, ghosts);
    transcript.append(live);
  }
  const title = live.querySelector("#live-title");
  if (title) {
    title.textContent = label;
  }
  const list = live.querySelector(".steps") as HTMLOListElement;
  list.replaceChildren();
  steps.forEach((step, index) => {
    const item = document.createElement("li");
    item.className = index < steps.length - 1 ? "done" : "";
    const mark = document.createElement("i");
    item.append(mark, document.createTextNode(step));
    list.append(item);
  });
}

function paintReport(report: TestReport, notes: string[], disciplineId: string, project: string, focus: string): void {
  transcript.replaceChildren();
  const result = document.createElement("section");
  result.className = "result";
  const counts = { pass: 0, fail: 0, blocked: 0 };
  for (const testCase of report.cases) {
    counts[testCase.status] += 1;
  }
  const head = document.createElement("div");
  head.className = "result-head";
  const kicker = document.createElement("p");
  kicker.className = "kicker";
  kicker.textContent = project;
  const verdict = document.createElement("p");
  const tone = counts.fail > 0 ? "fail" : counts.blocked > 0 ? "blocked" : "pass";
  verdict.className = `verdict ${tone}`;
  verdict.textContent =
    tone === "fail"
      ? "Hand this back. The change is named."
      : tone === "blocked"
        ? "Part of this tab could not be judged."
        : "Ready to hand over.";
  head.append(kicker, verdict);
  const stats = document.createElement("div");
  stats.className = "stats";
  stats.append(stat("pass", counts.pass, "Passed"), stat("fail", counts.fail, "Failed"), stat("blocked", counts.blocked, "Blocked"));
  result.append(head, stats);
  if (report.summary) {
    const summary = document.createElement("p");
    summary.className = "summary";
    summary.textContent = report.summary;
    result.append(summary);
  }
  const findings = document.createElement("div");
  findings.className = "findings";
  report.cases.forEach((testCase, index) => {
    const block = document.createElement("article");
    block.className = `finding ${testCase.status}`;
    block.style.animationDelay = `${index * 45}ms`;
    const top = document.createElement("header");
    const id = document.createElement("span");
    id.className = "id";
    id.textContent = testCase.id;
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = testCase.status === "pass" ? "Passed" : testCase.status === "fail" ? "Failed" : "Blocked";
    top.append(id, pill);
    const title = document.createElement("h3");
    title.textContent = testCase.title;
    const labels = fieldLabels(disciplineId);
    block.append(top, title, field(labels[0], testCase.expected), field(labels[1], testCase.actual));
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
    findings.append(block);
  });
  result.append(findings);
  const download = document.createElement("button");
  download.type = "button";
  download.className = "download";
  download.textContent = "Download PDF";
  download.addEventListener("click", () => {
    void savePdf(report, disciplineId, project, focus);
  });
  result.append(download);
  if (notes.length) {
    const line = document.createElement("p");
    line.className = "notes";
    line.textContent = notes.join(" ");
    result.append(line);
  }
  transcript.append(result);
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

function icon(kind: string): SVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", iconPath(kind));
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.8");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.append(path);
  return svg;
}

function iconPath(kind: string): string {
  if (kind === "api") {
    return "M9 8 5 12l4 4M15 8l4 4-4 4";
  }
  if (kind === "security") {
    return "M12 3.2 5.5 6.1v5.6c0 3.8 2.6 6.2 6.5 7.6 3.9-1.4 6.5-3.8 6.5-7.6V6.1L12 3.2z";
  }
  return "M7 3.5h10a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1zM9 8h6M9 12h6M9 16h4";
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

function ghost(): HTMLElement {
  const card = document.createElement("div");
  card.className = "stat";
  return card;
}
