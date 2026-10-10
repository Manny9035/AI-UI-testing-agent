import type { HostToWebview } from "./protocol";

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): unknown;
}

declare global {
  interface Window {
    acquireVsCodeApi: () => VsCodeApi;
  }
}

window.acquireVsCodeApi = () => ({
  postMessage(message: unknown) {
    const kind = (message as { type?: string }).type;
    if (kind === "ready") {
      const scene = new URLSearchParams(location.search).get("scene") || "empty";
      window.setTimeout(() => deliver(scene), 20);
    }
  },
  getState: () => null,
  setState: (state) => state,
});

function deliver(scene: string): void {
  const send = (data: HostToWebview) => {
    window.dispatchEvent(new MessageEvent("message", { data }));
  };
  const hasKey = scene !== "key";
  send({
    type: "init",
    workspaceName: "billing-service",
    fileCount: 18,
    hasKey,
    agent: "composer-2.5",
    sandboxLabel: scene === "running" ? "Composer running" : scene === "report" ? "Composer ready" : "No session",
  });
  if (scene === "report" || scene === "running") {
    send({
      type: "snapshot",
      snapshot: {
        running: scene === "running",
        sandboxLabel: scene === "running" ? "Composer running" : "Composer ready",
        turns: [
          {
            role: "user",
            disciplineLabel: "/Functional Testing",
            prompt: "Walk the main user path. Verify the behavior a person would hit first.",
            syncLabel: "18 files · 86 KB · .env left out · synced",
          },
          {
            role: "agent",
            phase: scene === "running" ? "Running functional tests" : "Finished",
            startedAt: Date.now() - 74000,
            endedAt: scene === "running" ? undefined : Date.now(),
            activities: [
              { id: "0", kind: "thought", title: "Reasoning", body: "" },
              { id: "1", kind: "tool", title: "npm test", body: "$ npm test\n\n  6 passing\n  1 failing" },
            ],
            answer: scene === "running"
              ? "The signup path accepts a valid email. I am still checking the empty-password failure."
              : "Signup accepts a valid account, and the empty-password path does not. The suite already covers the happy path. The failure is in the handler: an empty password still creates a session.\n\nI would not ship this until FT-02 is fixed.",
            usage: scene === "running" ? undefined : "8,420 tokens",
            report: scene === "running" ? undefined : {
              summary: "One failure: an empty password still opens a session.",
              cases: [
                {
                  id: "FT-01",
                  title: "Signup accepts a valid email and password",
                  status: "pass",
                  expected: "201 and a session cookie",
                  actual: "201 Created, session cookie set",
                  evidence: "POST /signup 201",
                },
                {
                  id: "FT-02",
                  title: "Signup rejects an empty password",
                  status: "fail",
                  expected: "400 and no session",
                  actual: "201 Created, session cookie set",
                  evidence: "POST /signup {\"email\":\"a@b.co\",\"password\":\"\"} → 201",
                },
                {
                  id: "FT-03",
                  title: "Signup rejects a duplicate email",
                  status: "blocked",
                  expected: "409 Conflict",
                  actual: "The route is not registered in this build.",
                  evidence: "GET /signup/check → 404",
                },
              ],
            },
          },
        ],
      },
    });
  }
}
