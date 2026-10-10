import type { TestCase, TestReport } from "./protocol";

const FENCE = /```nextops-report\s*([\s\S]*?)```/i;

export function parseNextOpsReport(text: string): TestReport | null {
  const fenced = text.match(FENCE);
  const source = fenced?.[1] ?? extractJsonObject(text);
  if (!source) {
    return null;
  }
  try {
    const parsed = JSON.parse(source) as unknown;
    return normalizeReport(parsed);
  } catch {
    return null;
  }
}

export function stripReportFence(text: string): { prose: string; pending: boolean } {
  const start = text.search(/```nextops-report/i);
  if (start === -1) {
    return { prose: text.trim(), pending: false };
  }
  const prose = text.slice(0, start).trim();
  const closed = /```nextops-report[\s\S]*?```/i.test(text);
  return { prose, pending: !closed };
}

function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    return null;
  }
  const slice = text.slice(start, end + 1);
  if (!slice.includes('"cases"')) {
    return null;
  }
  return slice;
}

function normalizeReport(value: unknown): TestReport | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.cases)) {
    return null;
  }
  const cases: TestCase[] = [];
  for (const item of record.cases) {
    const testCase = normalizeCase(item);
    if (testCase) {
      cases.push(testCase);
    }
  }
  if (!cases.length) {
    return null;
  }
  return {
    summary: asString(record.summary),
    cases,
  };
}

function normalizeCase(value: unknown): TestCase | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const title = asString(record.title);
  if (!title) {
    return null;
  }
  return {
    id: asString(record.id) || "FT",
    title,
    status: normalizeStatus(record.status),
    expected: asString(record.expected),
    actual: asString(record.actual),
    evidence: asString(record.evidence),
    improvement: asString(record.improvement) || undefined,
  };
}

function normalizeStatus(value: unknown): TestCase["status"] {
  const text = asString(value).toLowerCase();
  if (["pass", "passed", "ok", "success"].includes(text)) {
    return "pass";
  }
  if (["fail", "failed", "failure", "error"].includes(text)) {
    return "fail";
  }
  return "blocked";
}

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}
