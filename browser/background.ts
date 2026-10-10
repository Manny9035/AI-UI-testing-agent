import { collectPage, type PageEndpoint, type PageProbe } from "../src/pageProbe";
import { buildPageReport, type CallFact, type CookieFact } from "../src/pageReport";
import type { TestReport } from "../src/protocol";

const BRIDGE = "http://127.0.0.1:9477";

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message: { type?: string; discipline?: string; prompt?: string }, _sender, sendResponse) => {
  if (message.type === "status") {
    void status().then(sendResponse);
    return true;
  }
  if (message.type === "run") {
    void run(message.discipline || "functional", message.prompt || "").catch((error: unknown) => {
      const text = error instanceof Error ? error.message : "The check could not be finished.";
      void emit({ type: "error", message: text });
    });
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

async function status(): Promise<{ type: "status"; host: string | null; title: string | null; composer: boolean }> {
  const tab = await activeTab();
  const composer = await bridgeHealth();
  return { type: "status", host: hostOf(tab?.url), title: tab?.title || null, composer };
}

async function run(discipline: string, prompt: string): Promise<void> {
  const tab = await activeTab();
  if (!tab?.id || !tab.url || !/^https?:/i.test(tab.url)) {
    await emit({ type: "error", message: "Open the website you want to check, then try again." });
    return;
  }
  await emit({ type: "phase", label: "Reading this page" });
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: collectPage,
  });
  const probe = injection?.result as PageProbe | undefined;
  if (!probe?.url) {
    await emit({ type: "error", message: "Verity could not read this tab. Open a normal website and try again." });
    return;
  }
  let calls: CallFact[] = [];
  if (discipline === "api") {
    await emit({ type: "phase", label: "Calling the APIs on this page" });
    calls = await callGets(probe.endpoints, probe.url);
  }
  let cookies: CookieFact[] = [];
  if (discipline === "security") {
    await emit({ type: "phase", label: "Reviewing protections" });
    cookies = await cookieFacts(probe.url);
  }
  if (discipline === "functional") {
    await emit({ type: "phase", label: "Moving through the page" });
  }
  const project = hostOf(probe.url) || "This page";
  let report = buildPageReport({ discipline, focus: prompt, probe, calls, cookies });
  let notes: string[] = [];
  await emit({ type: "phase", label: "Writing the result" });
  const polished = await polish(discipline, prompt, project, report, probe.html, calls);
  if (polished) {
    report = polished.report;
    notes = polished.notes;
  }
  await emit({
    type: "report",
    report,
    notes,
    discipline,
    project,
    focus: prompt.trim(),
  });
}

async function callGets(endpoints: PageEndpoint[], pageUrl: string): Promise<CallFact[]> {
  const calls: CallFact[] = [];
  for (const endpoint of endpoints.slice(0, 6)) {
    if (endpoint.method !== "GET") {
      calls.push({
        method: endpoint.method,
        url: endpoint.url,
        sent: false,
        source: endpoint.source,
        body: `${endpoint.method} was not sent, because it could change data.`,
      });
      continue;
    }
    try {
      const same = new URL(endpoint.url).origin === new URL(pageUrl).origin;
      const response = await fetch(endpoint.url, {
        method: "GET",
        credentials: same ? "include" : "omit",
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
      });
      const text = redact(await response.text());
      if (response.status === 405 || response.status === 501) {
        calls.push({
          method: endpoint.method,
          url: endpoint.url,
          sent: false,
          status: response.status,
          source: endpoint.source,
          body: `This address returned ${response.status}, so Verity did not treat a GET as the real call.`,
        });
        continue;
      }
      calls.push({
        method: endpoint.method,
        url: endpoint.url,
        sent: true,
        status: response.status,
        body: text.slice(0, 280),
        source: endpoint.source,
      });
    } catch (error) {
      calls.push({
        method: endpoint.method,
        url: endpoint.url,
        sent: true,
        error: error instanceof Error ? error.message : "The call failed.",
        source: endpoint.source,
      });
    }
  }
  return calls;
}

async function cookieFacts(pageUrl: string): Promise<CookieFact[]> {
  const cookies = await chrome.cookies.getAll({ url: pageUrl });
  return cookies.slice(0, 20).map((cookie) => ({
    name: cookie.name,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite || "unspecified",
  }));
}

async function polish(
  discipline: string,
  focus: string,
  project: string,
  report: TestReport,
  html: string,
  calls: CallFact[],
): Promise<{ report: TestReport; notes: string[] } | null> {
  try {
    const response = await fetch(`${BRIDGE}/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        discipline,
        focus,
        project,
        report,
        html: discipline === "functional" ? html : "",
        calls: discipline === "api" ? calls : [],
      }),
      signal: AbortSignal.timeout(40000),
    });
    if (!response.ok) {
      return null;
    }
    const payload = (await response.json()) as { report?: TestReport; notes?: string[] };
    if (!payload.report?.cases?.length) {
      return null;
    }
    return { report: payload.report, notes: payload.notes || [] };
  } catch {
    return null;
  }
}

async function bridgeHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${BRIDGE}/health`, { signal: AbortSignal.timeout(800) });
    if (!response.ok) {
      return false;
    }
    const payload = (await response.json()) as { composer?: boolean };
    return Boolean(payload.composer);
  } catch {
    return false;
  }
}

function redact(value: string): string {
  return value.replace(/[A-Za-z0-9_\-]{32,}/g, "[redacted]");
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function hostOf(url: string | undefined): string | null {
  if (!url) {
    return null;
  }
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function emit(message: unknown): Promise<void> {
  return chrome.runtime.sendMessage(message).then(() => undefined).catch(() => undefined);
}
