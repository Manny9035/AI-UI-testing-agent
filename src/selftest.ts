import assert from "assert";
import { execFileSync } from "child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { renderMarkdown } from "./markdown";
import { priorityFor, shouldSkipPath } from "./pack";
import { buildTurnInput } from "./prompt";
import { drainSse, emptyRun, parseSseBlock, reduceEvent, visibleActivities } from "./reduce";
import { parseVerityReport, stripReportFence } from "./report";
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
  const dir = mkdtempSync(path.join(tmpdir(), "verity-tar-"));
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
    "```verity-report",
    JSON.stringify({
      summary: "One failure on the empty password.",
      cases: [
        { id: "FT-01", title: "Rejects an empty password", status: "failed", expected: "400", actual: "200", evidence: "curl -i /login" },
        { id: "FT-02", title: "Accepts a valid password", status: "passed", expected: "200", actual: "200", evidence: "curl /login" },
      ],
    }),
    "```",
  ].join("\n");
  const report = parseVerityReport(text);
  assert.ok(report);
  assert.equal(report?.cases[0].status, "fail");
  assert.equal(report?.cases[1].status, "pass");
  assert.equal(report?.summary, "One failure on the empty password.");
  const split = stripReportFence(text);
  assert.equal(split.prose, "The login path holds.");
  assert.equal(split.pending, false);
  assert.equal(stripReportFence("Hello\n```verity-report\n{").pending, true);
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

testTarRoundTrip();
testReportAndMarkdown();
testReducer();
testPackFilter();
console.log("verity selftest ok");
