export const COMPOSER_MODEL_ID = "composer-2.5";

export const REPORT_PATH = ".verity/report.json";

export function buildTurnInput(userPrompt: string): string {
  const focus = userPrompt.trim()
    ? userPrompt.trim()
    : "No extra focus. Cover the primary functional surface, at most 8 cases.";
  return [
    "Discipline: Functional testing.",
    "You are Verity. Prove whether the software in this working directory does what its behavior says it should do.",
    "Read the files you need. Run the checks here. Do not modify project source.",
    "Rules:",
    "- Map the system before testing it. Read the manifest, README, and entry points.",
    "- Design cases a tester would run: happy path, an alternate path, a boundary, and a failure path.",
    "- If the user named a focus, stay inside it. Otherwise stop at 8 cases on the primary surface.",
    "- Execute every case. Prefer the project's test runner. Otherwise write a small check outside the project source.",
    "- Do not rewrite product code to force a pass. Do not invent output. A case you did not run is blocked, not passed.",
    "- pass means you observed the expected behavior. fail means you observed something else. blocked means you could not run it.",
    "- If you see a credential, redact it.",
    "",
    "User focus:",
    focus,
    "",
    "Report only what you executed.",
    `Write ${REPORT_PATH} with this JSON shape, and end your reply with the same JSON inside a verity-report fence:`,
    '{"summary":"one or two sentences","cases":[{"id":"FT-01","title":"short behavior name","status":"pass","expected":"what should happen","actual":"what you observed","evidence":"the command and the relevant output"}]}',
    "The narrative comes first. The fence comes last. Do not write anything after the fence.",
  ].join("\n");
}
