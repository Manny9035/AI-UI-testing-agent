import http from "http";
import path from "path";
import { Agent, CursorAgentError } from "@cursor/sdk";
import { resolveComposer } from "./cursorSession";
import { readNamedEnv, resolveApiKey } from "./env";
import type { CallFact } from "./pageReport";
import { snapshotHtml } from "./playwrightPage";
import { postmanCollection, savePostmanCollection } from "./postmanCollection";
import type { TestCase, TestReport } from "./protocol";
import { parseNextOpsReport } from "./report";

const PORT = 9477;
const root = path.resolve(__dirname, "../..");

interface CheckBody {
  discipline?: string;
  focus?: string;
  project?: string;
  report?: TestReport;
  html?: string;
  calls?: CallFact[];
}

const server = http.createServer((req, res) => {
  const origin = "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    send(res, 200, {
      ok: true,
      composer: Boolean(resolveApiKey(root)),
      postman: Boolean(readNamedEnv(root, "POSTMAN_API_KEY")),
    });
    return;
  }
  if (req.method === "POST" && req.url === "/check") {
    void readBody(req)
      .then((body) => check(body))
      .then((payload) => send(res, 200, payload))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "The check could not be finished.";
        send(res, 500, { error: message });
      });
    return;
  }
  send(res, 404, { error: "Not found." });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`NextOps browser bridge listening on http://127.0.0.1:${PORT}`);
});

async function check(body: CheckBody): Promise<{ report: TestReport; notes: string[] }> {
  if (!body.report?.cases?.length) {
    throw new Error("The page did not produce a report.");
  }
  const notes: string[] = [];
  let report = body.report;
  if ((body.discipline || "").toLowerCase().includes("functional") && body.html) {
    try {
      const shot = await snapshotHtml(body.html, "");
      notes.push("Playwright read this page with getByRole and an aria snapshot.");
      report = attachSnapshot(report, shot.snapshot, shot.headings, shot.buttons);
    } catch {
      notes.push("Playwright could not open Chrome, so this result is from the open tab.");
    }
  }
  if ((body.discipline || "").toLowerCase().includes("api") && body.calls?.length) {
    const apiKey = readNamedEnv(root, "POSTMAN_API_KEY");
    if (apiKey) {
      try {
        const collection = postmanCollection(`NextOps ${body.project || "page"}`, body.calls);
        const id = await savePostmanCollection(apiKey, collection, readNamedEnv(root, "POSTMAN_WORKSPACE_ID"));
        notes.push("Saved the requests to Postman.");
        report = {
          ...report,
          summary: `${report.summary} The collection is in Postman (${id}).`,
        };
      } catch {
        notes.push("The requests were checked here. Postman did not accept the collection.");
      }
    }
  }
  const cursorKey = resolveApiKey(root);
  if (cursorKey) {
    try {
      const phrased = await phrase(cursorKey, report, body.focus || "");
      if (phrased) {
        report = phrased;
        notes.push("Composer Fast tightened the wording.");
      }
    } catch (error) {
      if (!(error instanceof CursorAgentError)) {
        notes.push("Composer Fast was not used. The result is from this tab.");
      } else {
        notes.push("Composer Fast was not used. The result is from this tab.");
      }
    }
  }
  return { report, notes };
}

function attachSnapshot(report: TestReport, snapshot: string, headings: number, buttons: number): TestReport {
  const excerpt = snapshot.split("\n").slice(0, 14).join("\n");
  const note = `Playwright aria snapshot (${headings} headings, ${buttons} buttons):\n${excerpt}`;
  const cases = report.cases.map((testCase, index) =>
    index === report.cases.length - 1 ? { ...testCase, evidence: `${testCase.evidence}\n\n${note}`.trim() } : testCase,
  );
  return { ...report, cases };
}

async function phrase(apiKey: string, report: TestReport, focus: string): Promise<TestReport | null> {
  const model = await resolveComposer(apiKey);
  const result = await Agent.prompt(
    [
      "You are NextOps. Rewrite this report so a tester who is not a developer can hand it over.",
      "Keep every case id, title, and status exactly as given.",
      "You may clarify the summary, expected, actual, and improvement.",
      "Use only the facts already in the report. Do not add cases.",
      "Do not describe how to attack the page.",
      focus.trim() ? `Focus: ${focus.trim()}` : "",
      "Reply with JSON only, in this shape:",
      '{"summary":"one or two sentences","cases":[{"id":"FT-01","title":"same title","status":"pass","expected":"...","actual":"...","evidence":"...","improvement":"..."}]}',
      "",
      JSON.stringify(report),
    ]
      .filter(Boolean)
      .join("\n"),
    {
      apiKey,
      model,
      tools: [],
      local: { cwd: root, settingSources: [] },
    },
  );
  if (result.status !== "finished") {
    return null;
  }
  const parsed = parseNextOpsReport(result.result || "");
  if (!parsed || !sameVerdicts(report, parsed)) {
    return null;
  }
  return parsed;
}

function sameVerdicts(original: TestReport, next: TestReport): boolean {
  if (original.cases.length !== next.cases.length) {
    return false;
  }
  return original.cases.every((testCase, index) => {
    const other: TestCase | undefined = next.cases[index];
    return other?.id === testCase.id && other.title === testCase.title && other.status === testCase.status;
  });
}

function readBody(req: http.IncomingMessage): Promise<CheckBody> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 2_000_000) {
        reject(new Error("The page was too large to send."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as CheckBody);
      } catch {
        reject(new Error("The check body was not JSON."));
      }
    });
    req.on("error", reject);
  });
}

function send(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}
