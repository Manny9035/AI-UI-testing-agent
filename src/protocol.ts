export interface TestCase {
  id: string;
  title: string;
  status: "pass" | "fail" | "blocked";
  expected: string;
  actual: string;
  evidence: string;
  improvement?: string;
}

export interface TestReport {
  summary: string;
  cases: TestCase[];
}

export interface ActivityItem {
  id: string;
  kind: "thought" | "tool";
  title: string;
  body: string;
}

export interface UserTurn {
  role: "user";
  disciplineLabel: string;
  prompt: string;
  syncLabel: string;
}

export interface AgentTurn {
  role: "agent";
  phase: string;
  activities: ActivityItem[];
  answer: string;
  report?: TestReport;
  error?: string;
  usage?: string;
  startedAt: number;
  endedAt?: number;
}

export type Turn = UserTurn | AgentTurn;

export interface Snapshot {
  turns: Turn[];
  running: boolean;
  sandboxLabel: string;
}

export type WebviewToHost =
  | { type: "ready" }
  | { type: "send"; discipline: string; prompt: string }
  | { type: "cancel" }
  | { type: "newSession" }
  | { type: "openEnv" };

export type HostToWebview =
  | {
      type: "init";
      workspaceName: string | null;
      fileCount: number;
      hasKey: boolean;
      agent: string;
      sandboxLabel: string;
    }
  | {
      type: "status";
      workspaceName: string | null;
      fileCount: number;
      hasKey: boolean;
      sandboxLabel: string;
    }
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "run-start"; turn: UserTurn }
  | { type: "sync"; label: string }
  | { type: "phase"; label: string }
  | { type: "notice"; message: string }
  | { type: "activity"; item: ActivityItem }
  | { type: "answer"; text: string }
  | { type: "report"; report: TestReport }
  | { type: "run-end"; usage?: string; endedAt: number }
  | { type: "run-error"; message: string; endedAt: number };
