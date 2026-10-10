export const COMPOSER_MODEL_ID = "composer-2.5";
export const COMPOSER_LABEL = "Composer Fast";

export const REPORT_PATH = ".verity/report.json";

export function buildTurnInput(userPrompt: string): string {
  const focus = userPrompt.trim()
    ? userPrompt.trim()
    : "No extra focus. Cover the primary functional surface, at most 8 cases.";
  return [
    "Discipline: Functional testing.",
    "You are Verity. Decide how this project should be tested from the code, then test it that way. Do not modify project source. Do not install packages, build, or start a server until the code says that is required.",
    "",
    "1. Identify the project before any command.",
    "Read the manifest, README, and the real entry files. Name the stack in one sentence: static page, library, service, or app with a build.",
    "",
    "2. Pick the method from that stack.",
    "- HTML, CSS, and JavaScript with no required build: read the files. Trace the implementation. Do not run the project. A case fails when the code would stop the behavior: a missing file, a selector or id that does not exist, a handler that never runs, a wrong path, a syntax error on load, or a control that does nothing. Evidence is the file path and the lines.",
    "- A project whose behavior only exists after a test runner, server, or build: run the narrowest command that proves the case. Skip setup the code does not need.",
    "",
    "3. Cases.",
    "Cover a happy path, an alternate path, a boundary, and a failure path. If the user named a focus, stay inside it. Otherwise stop at 8 cases.",
    "Do not invent output. A case you could not judge from the code, and did not run, is blocked, not passed.",
    "pass means the code or the run shows the expected behavior. fail means it shows something else. blocked means the files or the command needed to judge it were missing.",
    "If you see a credential, redact it.",
    "",
    "User focus:",
    focus,
    "",
    "Report only what you judged.",
    `Write ${REPORT_PATH} with this JSON shape, and end your reply with the same JSON inside a verity-report fence:`,
    '{"summary":"one or two sentences","cases":[{"id":"FT-01","title":"short behavior name","status":"pass","expected":"what should happen","actual":"what you observed","evidence":"file and lines, or the command and its output"}]}',
    "The narrative comes first. The fence comes last. Do not write anything after the fence.",
  ].join("\n");
}
