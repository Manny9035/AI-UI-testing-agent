import assert from "assert";
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { PDFDocument } from "pdf-lib";
import { renderMarkdown } from "./markdown";
import { priorityFor, shouldSkipPath } from "./pack";
import { buildTurnInput } from "./prompt";
import { drainSse, emptyRun, parseSseBlock, reduceEvent, visibleActivities } from "./reduce";
import { parseNextOpsReport, stripReportFence } from "./report";
import { buildPageReport } from "./pageReport";
import { snapshotHtml } from "./playwrightPage";
import { postmanCollection } from "./postmanCollection";
import { buildReportPdf, reportFileName } from "./reportPdf";
import { createTarGz } from "./tar";

function testTarRoundTrip(): void {
  const archive = createTarGz([
    { name: "src/app.ts", data: Buffer.from("export const answer = 42;\n") },
    { name: "README.md", data: Buffer.from("# Demo\n") },
    {
      name: `${"nested/".repeat(15)}deep-file.txt`,
      data: Buffer.from("deep\n"),
    },
  ]);
  const dir = mkdtempSync(path.join(tmpdir(), "nextops-tar-"));
  const archivePath = path.join(dir, "project.tar.gz");
  writeFileSync(archivePath, archive);
  execFileSync("tar", ["-xzf", archivePath, "-C", dir]);
  assert.equal(readFileSync(path.join(dir, "src/app.ts"), "utf8"), "export const answer = 42;\n");
  assert.equal(readFileSync(path.join(dir, "README.md"), "utf8"), "# Demo\n");
  assert.equal(readFileSync(path.join(dir, `${"nested/".repeat(15)}deep-file.txt`), "utf8"), "deep\n");
  rmSync(dir, { recursive: true, force: true });
}

function testReportAndMarkdown(): void {
  const text = [
    "The login path holds.",
    "```nextops-report",
    JSON.stringify({
      summary: "One failure on the empty password.",
      cases: [
        { id: "FT-01", title: "Rejects an empty password", status: "failed", expected: "400", actual: "200", evidence: "curl -i /login" },
        { id: "FT-02", title: "Accepts a valid password", status: "passed", expected: "200", actual: "200", evidence: "curl /login" },
      ],
    }),
    "```",
  ].join("\n");
  const report = parseNextOpsReport(text);
  assert.ok(report);
  assert.equal(report?.cases[0].status, "fail");
  assert.equal(report?.cases[1].status, "pass");
  assert.equal(report?.summary, "One failure on the empty password.");
  const split = stripReportFence(text);
  assert.equal(split.prose, "The login path holds.");
  assert.equal(split.pending, false);
  assert.equal(stripReportFence("Hello\n```nextops-report\n{").pending, true);
  const html = renderMarkdown("Use `<script>` and **do** this\n\n```ts\nconst x = 1;\n```");
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("<strong>do</strong>"));
  assert.ok(html.includes("<pre><code>"));
}

function testReducer(): void {
  const state = emptyRun();
  const blocks = [
    `event: interaction.created\ndata: ${JSON.stringify({ event_type: "interaction.created", interaction: { id: "int_1", environment_id: "env_1", status: "in_progress" } })}`,
    `event: step.start\ndata: ${JSON.stringify({ event_type: "step.start", index: 0, step: { type: "thought" } })}`,
    `event: step.delta\ndata: ${JSON.stringify({ event_type: "step.delta", index: 0, delta: { type: "thought_signature", signature: "abc" } })}`,
    `event: step.stop\ndata: ${JSON.stringify({ event_type: "step.stop", index: 0 })}`,
    `event: step.start\ndata: ${JSON.stringify({ event_type: "step.start", index: 1, step: { type: "function_call", name: "code_execution", arguments: { command: "npm test" } } })}`,
    `event: step.delta\ndata: ${JSON.stringify({ event_type: "step.delta", index: 1, delta: { type: "text", text: "4 passing" } })}`,
    `event: step.start\ndata: ${JSON.stringify({ event_type: "step.start", index: 2, step: { type: "model_output" } })}`,
    `event: step.delta\ndata: ${JSON.stringify({ event_type: "step.delta", index: 2, delta: { type: "text", text: "Login " } })}`,
    `event: step.delta\ndata: ${JSON.stringify({ event_type: "step.delta", index: 2, delta: { type: "text", text: "holds." } })}`,
    `event: interaction.completed\ndata: ${JSON.stringify({ event_type: "interaction.completed", interaction: { id: "int_2", environment_id: "env_1", output_text: "Login holds.", usage: { total_tokens: 1200 } } })}`,
  ];
  let buffer = `${blocks.join("\n\n")}\n\n`;
  buffer = drainSse(buffer, (message) => reduceEvent(state, message));
  assert.equal(buffer, "");
  assert.equal(state.environmentId, "env_1");
  assert.equal(state.interactionId, "int_2");
  assert.equal(state.answer, "Login holds.");
  assert.equal(state.usage, "1,200 tokens");
  const activities = visibleActivities(state);
  assert.equal(activities[0]?.title, "Reasoning");
  assert.equal(activities[1]?.title, "npm test");
  assert.ok(activities[1]?.body.includes("4 passing"));
  assert.equal(parseSseBlock("data: [DONE]")?.event, "done");
}

function testPackFilter(): void {
  assert.equal(shouldSkipPath(".env"), true);
  assert.equal(shouldSkipPath("src/.env.local"), true);
  assert.equal(shouldSkipPath("node_modules/leftpad/index.js"), true);
  assert.equal(shouldSkipPath("secrets/id_rsa.pem"), true);
  assert.equal(shouldSkipPath("package-lock.json"), true);
  assert.equal(shouldSkipPath("src/app.ts"), false);
  assert.ok(priorityFor("package.json") > priorityFor("src/app.ts"));
  assert.ok(priorityFor("src/app.test.ts") > priorityFor("notes.txt"));
  const input = buildTurnInput("");
  assert.ok(input.includes("Functional testing"));
  assert.ok(input.includes("blocked, not passed"));
  const api = buildTurnInput("orders", "api");
  assert.ok(api.includes("API testing"));
  assert.ok(api.includes("improvement"));
  assert.ok(api.includes("orders"));
  const security = buildTurnInput("login", "security");
  assert.ok(security.includes("Security testing"));
  assert.ok(security.includes("improvement"));
  assert.ok(security.includes("login"));
}

async function testReportPdf(): Promise<void> {
  const generatedAt = Date.UTC(2026, 9, 10, 12);
  assert.equal(reportFileName("Security Testing", generatedAt), "NextOps-Security-Testing-2026-10-10.pdf");
  assert.equal(reportFileName("UI/UX Testing", generatedAt), "NextOps-UI-UX-Testing-2026-10-10.pdf");
  const security = await loadPdf(
    await buildReportPdf({
      project: "Checkout",
      discipline: "Security Testing",
      focus: "login form",
      generatedAt,
      report: {
        summary: "The login form checks the password, and the session cookie is missing a protection.",
        cases: [
          {
            id: "ST-01",
            title: `Session cookie is sent only over a protected connection ${"A".repeat(80)}`,
            status: "fail",
            expected: "The session cookie is marked Secure and HttpOnly.",
            actual: "The cookie is set without those flags. “Smart quotes” should stay readable.",
            evidence: "src/auth.ts sets the cookie in login().",
            improvement: "Mark the session cookie Secure and HttpOnly when the login succeeds.",
          },
          {
            id: "ST-02",
            title: "Password length is checked before it is sent",
            status: "pass",
            expected: "Passwords shorter than 8 characters are rejected.",
            actual: "The form rejects passwords under 8 characters.",
            evidence: "src/login.js checks value.length.",
          },
          {
            id: "ST-03",
            title: "Reset token storage could not be judged",
            status: "blocked",
            expected: "Reset tokens expire and are stored out of the page.",
            actual: "The reset module is not in this folder.",
            evidence: "",
          },
        ],
      },
    }),
  );
  assert.equal(security.getTitle(), "Security Testing - Checkout");
  assert.match(security.getSubject() ?? "", /prevent each gap/);
  assert.ok(security.getPageCount() >= 1);

  const api = await loadPdf(
    await buildReportPdf({
      project: "Orders",
      discipline: "API Testing",
      focus: "",
      generatedAt,
      report: {
        summary: "The orders endpoint returns a field the client never reads.",
        cases: [
          {
            id: "AT-01",
            title: "List orders",
            status: "fail",
            expected: "The client reads id and total.",
            actual: "The response also returns currency, and the client drops it.",
            evidence: "GET /orders returned 200.",
            improvement: "Read currency from the response before rendering the total.",
          },
        ],
      },
    }),
  );
  assert.match(api.getSubject() ?? "", /endpoint/);

  const functional = await loadPdf(
    await buildReportPdf({
      project: "Checkout",
      discipline: "Functional Testing",
      focus: "",
      generatedAt,
      report: {
        summary: "Empty cart checkout stays on the page.",
        cases: [
          {
            id: "FT-01",
            title: "Empty cart",
            status: "pass",
            expected: "Checkout does not submit an empty cart.",
            actual: "The handler returns before submit.",
            evidence: "src/cart.js",
          },
        ],
      },
    }),
  );
  assert.match(functional.getSubject() ?? "", /judged from the code/);
}

async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  assert.equal(Buffer.from(bytes.subarray(0, 5)).toString("latin1"), "%PDF-");
  return PDFDocument.load(bytes);
}

function testPageReport(): void {
  const probe = {
    url: "https://shop.example/checkout",
    title: "Checkout",
    heading: "Checkout",
    h1: 1,
    hasMain: true,
    https: true,
    passwordInUrl: false,
    snapshot: '- heading "Checkout" [level=1]\n- button "Save"',
    html: "<html></html>",
    controls: [
      { role: "button", name: "", visible: true, enabled: true, href: "" },
      { role: "button", name: "Save", visible: true, enabled: true, href: "" },
    ],
    images: [{ alt: null, src: "/logo.png", broken: false }],
    fields: [{ label: "Email", type: "email" }],
    links: [{ text: "Orders", href: "https://shop.example/orders", blank: true, noopener: false }],
    endpoints: [{ method: "GET", url: "https://shop.example/api/orders", source: "fetch() in the page script" }],
    actions: [{ name: "Walk", result: "Scrolled 1 section into view and focused 1 field." }],
  };
  const functional = buildPageReport({ discipline: "functional", focus: "checkout", probe, calls: [], cookies: [] });
  assert.equal(functional.cases.find((item) => item.title === "Buttons and links have a name")?.status, "fail");
  assert.equal(functional.cases.find((item) => item.title === "Pictures have a description")?.status, "fail");
  assert.match(functional.summary, /checkout/);
  const api = buildPageReport({
    discipline: "api",
    focus: "",
    probe,
    calls: [
      {
        method: "GET",
        url: "https://shop.example/api/orders",
        sent: true,
        status: 200,
        body: '{"id":1}',
        source: "fetch() in the page script",
      },
    ],
    cookies: [],
  });
  assert.equal(api.cases[0]?.status, "pass");
  assert.match(api.cases[0]?.title || "", /GET/);
  const security = buildPageReport({
    discipline: "security",
    focus: "",
    probe: { ...probe, https: false },
    calls: [],
    cookies: [{ name: "sid", secure: false, httpOnly: false, sameSite: "lax" }],
  });
  assert.equal(security.cases.find((item) => item.id === "ST-01")?.status, "fail");
  assert.equal(security.cases.find((item) => item.id === "ST-03")?.status, "fail");
  assert.match(security.cases.find((item) => item.id === "ST-03")?.improvement || "", /HttpOnly/);
  const collection = postmanCollection("NextOps shop.example", api.cases.length ? [{
    method: "GET",
    url: "https://shop.example/api/orders",
    sent: true,
    status: 200,
    source: "fetch() in the page script",
  }] : []);
  assert.match(collection.info.schema, /v2\.1\.0/);
  assert.equal(collection.item[0]?.request.method, "GET");
  const blocked = buildPageReport({
    discipline: "api",
    focus: "",
    probe: { ...probe, endpoints: [] },
    calls: [],
    cookies: [],
  });
  assert.equal(blocked.cases[0]?.status, "blocked");
}

async function testPlaywrightSnapshot(): Promise<void> {
  const html = `<!doctype html><html><head><title>Checkout</title></head><body><main><h1>Checkout</h1><button>Save</button><label>Email <input type="email"></label></main></body></html>`;
  try {
    const shot = await snapshotHtml(html, "https://shop.example/checkout");
    assert.ok(shot.headings >= 1);
    assert.ok(shot.buttons >= 1);
    assert.match(shot.snapshot, /heading/i);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/channel|executable|browserType|chrome|msedge|launch/i.test(message)) {
      throw error;
    }
    console.log("playwright chrome skipped");
  }
}

async function main(): Promise<void> {
  testTarRoundTrip();
  testReportAndMarkdown();
  testReducer();
  testPackFilter();
  testPageReport();
  await testReportPdf();
  await testPlaywrightSnapshot();
  console.log("nextops selftest ok");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
