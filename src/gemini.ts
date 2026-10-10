import { AGENT, AGENTS_MD, BOOTSTRAP_INPUT, MODEL, REPORT_PATH } from "./prompt";
import { drainSse, emptyRun, reduceEvent, type RunState, type SseMessage } from "./reduce";

const API = "https://generativelanguage.googleapis.com/v1beta";

export interface GeminiLogger {
  (line: string): void;
}

export interface FinishedRun {
  state: RunState;
  environmentId: string;
  interactionId: string;
}

export class Cancelled extends Error {
  constructor() {
    super("Stopped.");
    this.name = "Cancelled";
  }
}

export class GeminiClient {
  constructor(
    private readonly apiKey: string,
    private readonly log: GeminiLogger,
  ) {}

  async bootstrap(signal: AbortSignal): Promise<{ environmentId: string; interactionId: string }> {
    const environment = {
      type: "remote",
      sources: [
        {
          type: "inline",
          target: ".agents/AGENTS.md",
          content: AGENTS_MD,
        },
      ],
    };
    const interaction = await this.create(
      {
        agent: AGENT,
        input: BOOTSTRAP_INPUT,
        environment,
        agent_config: { type: "antigravity", model: MODEL },
        store: true,
      },
      signal,
      180_000,
    );
    const environmentId = stringField(interaction, "environment_id", "environmentId");
    const interactionId = stringField(interaction, "id");
    if (!environmentId) {
      throw new Error("The sandbox did not return an environment id, so the project could not be uploaded.");
    }
    if (!interactionId) {
      throw new Error("Gemini did not return an interaction id.");
    }
    this.log(`Sandbox ready ${environmentId}`);
    return { environmentId, interactionId };
  }

  async upload(environmentId: string, archive: Buffer, signal: AbortSignal): Promise<void> {
    const path = "workspace/project";
    const url = `${API.replace("/v1beta", "/upload/v1beta")}/environments/${encodeURIComponent(environmentId)}/files/${path}?extract=true&overwrite=true`;
    this.log(`PUT upload/v1beta/environments/${environmentId}/files/${path} (${archive.length} bytes)`);
    let response = await fetch(url, {
      method: "PUT",
      headers: {
        "x-goog-api-key": this.apiKey,
        "Content-Type": "application/gzip",
      },
      body: new Uint8Array(archive),
      signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
    });
    if (!response.ok && response.status === 400) {
      this.log("Upload rejected gzip content type, retrying as octet-stream");
      response = await fetch(url, {
        method: "PUT",
        headers: {
          "x-goog-api-key": this.apiKey,
          "Content-Type": "application/octet-stream",
        },
        body: new Uint8Array(archive),
        signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
      });
    }
    if (!response.ok) {
      throw new Error(await explain(response));
    }
    this.log(`Upload finished (${response.status})`);
  }

  async run(
    options: {
      environmentId: string;
      previousInteractionId?: string;
      input: string;
      onUpdate: (state: RunState) => void;
    },
    signal: AbortSignal,
  ): Promise<FinishedRun> {
    const body: Record<string, unknown> = {
      agent: AGENT,
      input: options.input,
      environment: options.environmentId,
      stream: true,
      store: true,
      agent_config: { type: "antigravity", model: MODEL },
    };
    if (options.previousInteractionId) {
      body.previous_interaction_id = options.previousInteractionId;
    }
    const response = await this.post(body, AbortSignal.any([signal, AbortSignal.timeout(12 * 60 * 1000)]));
    if (!response.ok) {
      throw new Error(await explain(response));
    }
    const state = emptyRun();
    state.environmentId = options.environmentId;
    const publish = () => options.onUpdate(cloneState(state));
    await consume(response, (message) => {
      reduceEvent(state, message);
      publish();
    });
    const environmentId = state.environmentId || options.environmentId;
    const interactionId = state.interactionId || options.previousInteractionId || "";
    if (state.status === "failed") {
      throw new Error(state.answer || "The agent run failed.");
    }
    return { state, environmentId, interactionId };
  }

  async downloadReport(environmentId: string, signal: AbortSignal): Promise<string | null> {
    const paths = [REPORT_PATH, "verity/report.json", "workspace/project/.verity/report.json"];
    for (const reportPath of paths) {
      const url = `${API}/environments/${encodeURIComponent(environmentId)}/files/${reportPath}?alt=media`;
      this.log(`GET report ${reportPath}`);
      try {
        const response = await fetch(url, {
          headers: { "x-goog-api-key": this.apiKey },
          signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        });
        if (response.ok) {
          return await response.text();
        }
        this.log(`Report ${reportPath} returned ${response.status}`);
      } catch (error) {
        if (isAbort(error)) {
          throw error;
        }
        this.log(`Report download skipped: ${error instanceof Error ? error.message : "unknown error"}`);
        return null;
      }
    }
    return null;
  }

  async deleteEnvironment(environmentId: string): Promise<void> {
    const url = `${API}/environments/${encodeURIComponent(environmentId)}`;
    this.log(`DELETE environment ${environmentId}`);
    try {
      const response = await fetch(url, {
        method: "DELETE",
        headers: { "x-goog-api-key": this.apiKey },
        signal: AbortSignal.timeout(20_000),
      });
      this.log(`Delete returned ${response.status}`);
    } catch (error) {
      this.log(`Delete skipped: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }

  private async create(
    body: Record<string, unknown>,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    const response = await this.post(body, AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]));
    if (!response.ok) {
      throw new Error(await explain(response));
    }
    const json = (await response.json()) as unknown;
    const record = asRecord(json);
    if (!record) {
      throw new Error("Gemini returned an empty interaction.");
    }
    return record;
  }

  private async post(body: Record<string, unknown>, signal: AbortSignal): Promise<Response> {
    const url = `${API}/interactions`;
    let attempt = { ...body };
    this.log(`POST /v1beta/interactions agent=${String(attempt.agent)} stream=${String(Boolean(attempt.stream))}`);
    let response = await fetch(url, {
      method: "POST",
      headers: {
        "x-goog-api-key": this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(attempt),
      signal,
    });
    if (response.status === 400) {
      const detail = await response.clone().text();
      const next = { ...attempt };
      let changed = false;
      for (const key of ["agent_config", "store"] as const) {
        if (key in next && detail.toLowerCase().includes(key)) {
          delete next[key];
          changed = true;
        }
      }
      if (!changed && ("agent_config" in next || "store" in next)) {
        delete next.agent_config;
        delete next.store;
        changed = true;
      }
      if (changed) {
        this.log("Retrying interaction without optional fields the API rejected");
        attempt = next;
        response = await fetch(url, {
          method: "POST",
          headers: {
            "x-goog-api-key": this.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(attempt),
          signal,
        });
      }
    }
    this.log(`Interaction response ${response.status}`);
    return response;
  }
}

async function consume(response: Response, onMessage: (message: SseMessage) => void): Promise<void> {
  const type = response.headers.get("content-type") || "";
  if (!response.body) {
    const json = (await response.json()) as unknown;
    onMessage({ event: "interaction.completed", data: { interaction: json, event_type: "interaction.completed" } });
    return;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let mode: "unknown" | "sse" | "json" = type.includes("event-stream") ? "sse" : "unknown";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    if (mode === "unknown") {
      const head = buffer.trimStart();
      if (!head) {
        continue;
      }
      mode = head.startsWith("{") || head.startsWith("[") ? "json" : "sse";
    }
    if (mode === "sse") {
      buffer = drainSse(buffer, onMessage);
    }
  }
  buffer += decoder.decode();
  if (mode === "json") {
    const json = JSON.parse(buffer) as unknown;
    onMessage({ event: "interaction.completed", data: { interaction: json, event_type: "interaction.completed" } });
    return;
  }
  if (buffer.trim()) {
    drainSse(`${buffer}\n\n`, onMessage);
  }
}

async function explain(response: Response): Promise<string> {
  const detail = await response.text();
  let message = "";
  try {
    const json = JSON.parse(detail) as { error?: { message?: string; status?: string } };
    message = json.error?.message || json.error?.status || "";
  } catch {
    message = detail.replace(/\s+/g, " ").trim();
  }
  const short = message.length > 320 ? `${message.slice(0, 319)}…` : message;
  if (response.status === 401 || response.status === 403) {
    return `Gemini rejected the API key. Check GEMINI_API_KEY in the Verity folder .env file. ${short}`.trim();
  }
  if (response.status === 404) {
    return `Not found (404). ${short}`.trim();
  }
  if (response.status === 429) {
    return "Gemini is rate limiting this key. Wait a moment, then send again.";
  }
  return short || `Gemini returned HTTP ${response.status}.`;
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function cloneState(state: RunState): RunState {
  return {
    ...state,
    steps: Object.fromEntries(Object.entries(state.steps).map(([id, step]) => [id, { ...step }])),
  };
}

export function isAbort(error: unknown): boolean {
  if (error instanceof Cancelled) {
    return true;
  }
  if (error instanceof Error && error.name === "AbortError") {
    return true;
  }
  return false;
}

export function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || /timeout/i.test(error.message));
}

export function isMissingEnvironment(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return /\b404\b/.test(message) || /not found/i.test(message) || /environment/i.test(message) && /expired|invalid/i.test(message);
}
