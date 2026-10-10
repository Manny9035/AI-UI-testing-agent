export const COMPOSER_MODEL_ID = "composer-2.5";
export const COMPOSER_LABEL = "Composer Fast";

export const REPORT_PATH = ".verity/report.json";

export function buildTurnInput(userPrompt: string, disciplineId = "functional"): string {
  if (disciplineId === "api") {
    return apiTurnInput(userPrompt);
  }
  if (disciplineId === "security") {
    return securityTurnInput(userPrompt);
  }
  const focus = userPrompt.trim()
    ? userPrompt.trim()
    : "No extra focus. Cover the primary functional surface, at most 8 cases.";
  return [
    "Discipline: Functional testing.",
    "You are NextOps. Decide how this project should be tested from the code, then test it that way. Do not modify project source. Do not install packages, build, or start a server until the code says that is required.",
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

function apiTurnInput(userPrompt: string): string {
  const focus = userPrompt.trim()
    ? userPrompt.trim()
    : "No extra focus. Cover the primary endpoints, at most 8.";
  return [
    "Discipline: API testing.",
    "You are NextOps. Call the API, then compare that response with the code that sends or handles it. Do not modify project source.",
    "",
    "1. Find the API in the code before you call it.",
    "Read routes, clients, fetch or XHR calls, and any contract. For each endpoint, name the method, the path, and the file that implements the caller or the handler.",
    "",
    "2. Get the real response.",
    "Send the request. Record the status and the body. Do not invent a response. Start a server only when the project already documents that command and the endpoint is not already reachable. If you still cannot get a response, mark the live check blocked and judge the implementation against the contract in the code.",
    "",
    "3. Compare the implementation with the response.",
    "expected is what the code assumes. actual is what the API returned, or what the handler code produces when the API could not be called.",
    "Fail the case when the code reads a field the response does not have, ignores a field the response does have, handles the wrong status, or drops an error body.",
    "improvement is the change that would make the implementation match the API. One or two sentences. Leave it empty only when they already match.",
    "",
    "4. Cases.",
    "If the user named a focus, stay inside it. Otherwise stop at 8 endpoints. Include one success, one bad input, and one failure status when the API has them.",
    "pass means the implementation matches the observed response. fail means it does not. blocked means there was no response and the code had no contract to judge.",
    "A case you did not call, and could not judge from the code, is blocked, not passed.",
    "If you see a credential, redact it.",
    "",
    "User focus:",
    focus,
    "",
    "Report only what you judged.",
    `Write ${REPORT_PATH} with this JSON shape, and end your reply with the same JSON inside a verity-report fence:`,
    '{"summary":"one or two sentences","cases":[{"id":"AT-01","title":"endpoint name","status":"fail","expected":"what the code assumes","actual":"the status and body you received","evidence":"the request and the file that handles it","improvement":"what to change so the code matches the API"}]}',
    "The narrative comes first. The fence comes last. Do not write anything after the fence.",
  ].join("\n");
}

function securityTurnInput(userPrompt: string): string {
  const focus = userPrompt.trim()
    ? userPrompt.trim()
    : "No extra focus. Review the protections this code actually implements, at most 8.";
  return [
    "Discipline: Security testing.",
    "You are NextOps. Review how this project handles untrusted input and the protections around it. Recommend the prevention for each gap. Do not modify project source. Do not attack the app, and do not write exploit steps.",
    "",
    "1. Read the code that accepts input.",
    "Find forms, query parameters, request bodies, headers, file names, and anything written into HTML, a query, a shell command, or a path. Name the file and the lines. Do not install a scanner or start the app unless the protection cannot be judged from those lines.",
    "",
    "2. Judge only what is implemented.",
    "Look at input checks, output encoding, authentication on sensitive actions, authorization, secrets in source or client code, and cookies or sessions the code sets.",
    "expected is the protection that should be there. actual is what the code does.",
    "Fail the case when input is trusted without a check, output is inserted without encoding, a sensitive action has no auth check, or a secret is present in the project.",
    "improvement is the specific prevention: what to validate, encode, require, or remove. One or two sentences. Leave it empty only when the protection is already in place.",
    "",
    "3. Cases.",
    "If the user named a focus, stay inside it. Otherwise stop at 8. Skip categories the project does not have.",
    "pass means the protection is implemented. fail means it is missing or incomplete. blocked means the code that would contain it is not in this folder.",
    "A case you could not judge from the code is blocked, not passed.",
    "If you see a credential, redact it. Do not repeat a secret in the report.",
    "",
    "User focus:",
    focus,
    "",
    "Report only what you judged.",
    `Write ${REPORT_PATH} with this JSON shape, and end your reply with the same JSON inside a verity-report fence:`,
    '{"summary":"one or two sentences","cases":[{"id":"ST-01","title":"short protection name","status":"fail","expected":"the protection that should exist","actual":"what the code does","evidence":"file and lines","improvement":"how to prevent it"}]}',
    "The narrative comes first. The fence comes last. Do not write anything after the fence.",
  ].join("\n");
}
