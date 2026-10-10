import type { ActivityItem } from "./protocol";

export interface StepState {
  id: string;
  kind: "thought" | "tool" | "answer";
  title: string;
  body: string;
  done: boolean;
}

export interface RunState {
  environmentId?: string;
  interactionId?: string;
  steps: Record<string, StepState>;
  answer: string;
  usage?: string;
  status?: string;
}

export function emptyRun(): RunState {
  return { steps: {}, answer: "" };
}

export interface SseMessage {
  event: string;
  data: unknown;
}

/** Fold one Interactions API stream event into the run the view renders. */
export function reduceEvent(state: RunState, message: SseMessage): RunState {
  const data = asRecord(message.data) ?? {};
  const event = String(data.event_type || message.event || "");
  if (event === "interaction.created" || event === "interaction.completed" || event === "interaction.failed") {
    const interaction = asRecord(data.interaction) ?? data;
    rememberIds(state, interaction);
    const output = firstString(interaction.output_text, interaction.outputText);
    if (output) {
      state.answer = output;
    }
    const usage = formatUsage(interaction.usage);
    if (usage) {
      state.usage = usage;
    }
    if (typeof interaction.status === "string") {
      state.status = interaction.status;
    }
    if (Array.isArray(interaction.steps) && !state.answer) {
      absorbSteps(state, interaction.steps);
    } else if (Array.isArray(interaction.steps)) {
      absorbToolSteps(state, interaction.steps);
    }
    const error = asRecord(interaction.error) ?? asRecord(data.error);
    if (error && typeof error.message === "string" && event === "interaction.failed") {
      state.status = "failed";
      state.answer = state.answer || error.message;
    }
    return state;
  }
  if (event === "step.start") {
    const index = String(data.index ?? Object.keys(state.steps).length);
    const step = asRecord(data.step) ?? {};
    const kind = classify(step);
    const view: StepState = {
      id: index,
      kind,
      title: titleFor(step, kind),
      body: kind === "tool" ? bodyFor(step) : "",
      done: false,
    };
    state.steps[index] = view;
    if (kind === "answer") {
      const text = extractText(step);
      if (text) {
        state.answer += text;
      }
    }
    return state;
  }
  if (event === "step.delta") {
    const index = String(data.index ?? "");
    const step = state.steps[index];
    const delta = asRecord(data.delta) ?? {};
    const text = typeof delta.text === "string" ? delta.text : extractText(delta);
    if (!step) {
      if (text && !isSignature(delta)) {
        state.answer += text;
      }
      return state;
    }
    if (step.kind === "answer") {
      if (text && !isSignature(delta)) {
        state.answer += text;
      }
    } else if (step.kind === "tool") {
      const command = commandOf(delta);
      if (command && !step.body.includes(command)) {
        step.body = step.body ? `${step.body}\n${command}` : command;
        step.title = clip(command.replace(/^\$\s*/, ""), 88) || step.title;
      }
      if (text && !isSignature(delta)) {
        step.body = step.body ? `${step.body}\n${text}` : text;
      }
    }
    return state;
  }
  if (event === "step.stop") {
    const index = String(data.index ?? "");
    const step = state.steps[index];
    if (step) {
      step.done = true;
    }
    const usage = formatUsage(data.usage);
    if (usage) {
      state.usage = usage;
    }
    return state;
  }
  return state;
}

export function visibleActivities(state: RunState): ActivityItem[] {
  return Object.values(state.steps)
    .filter((step) => step.kind !== "answer")
    .map((step) => {
      const title = step.title;
      const body = step.kind === "thought" ? "" : outputAfterTitle(title, step.body);
      return {
        id: step.id,
        kind: step.kind === "thought" ? "thought" : "tool",
        title,
        body: clip(body, 4000),
      };
    });
}

function outputAfterTitle(title: string, body: string): string {
  let text = body.trim();
  const bare = title.replace(/^\$\s*/, "");
  for (const prefix of [title, `$ ${bare}`, bare]) {
    if (!prefix) {
      continue;
    }
    if (text === prefix) {
      return "";
    }
    if (text.startsWith(`${prefix}\n`)) {
      text = text.slice(prefix.length + 1).trim();
      break;
    }
  }
  return text;
}

export function parseSseBlock(block: string): SseMessage | null {
  let event = "message";
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) {
      continue;
    }
    if (line.startsWith("event:")) {
      event = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }
  if (!dataLines.length) {
    return null;
  }
  const raw = dataLines.join("\n");
  if (raw === "[DONE]") {
    return { event: "done", data: null };
  }
  try {
    const data = JSON.parse(raw) as unknown;
    const record = asRecord(data);
    const named = record && typeof record.event_type === "string" ? record.event_type : event;
    return { event: named, data };
  } catch {
    return { event, data: raw };
  }
}

/** Pull complete SSE blocks out of a buffer. Returns the unparsed tail. */
export function drainSse(buffer: string, onMessage: (message: SseMessage) => void): string {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const tail = parts.pop() ?? "";
  for (const part of parts) {
    const message = parseSseBlock(part);
    if (message) {
      onMessage(message);
    }
  }
  return tail;
}

function absorbSteps(state: RunState, steps: unknown[]): void {
  steps.forEach((step, index) => {
    const record = asRecord(step) ?? {};
    const kind = classify(record);
    const id = String(index);
    state.steps[id] = {
      id,
      kind,
      title: titleFor(record, kind),
      body: kind === "tool" ? bodyFor(record) : "",
      done: true,
    };
    if (kind === "answer") {
      state.answer += extractText(record);
    }
  });
}

function absorbToolSteps(state: RunState, steps: unknown[]): void {
  if (Object.keys(state.steps).length > 0) {
    return;
  }
  steps.forEach((step, index) => {
    const record = asRecord(step) ?? {};
    const kind = classify(record);
    if (kind === "answer") {
      return;
    }
    const id = String(index);
    state.steps[id] = {
      id,
      kind,
      title: titleFor(record, kind),
      body: kind === "tool" ? bodyFor(record) : "",
      done: true,
    };
  });
}

function rememberIds(state: RunState, interaction: Record<string, unknown>): void {
  const id = firstString(interaction.id);
  const environmentId = firstString(interaction.environment_id, interaction.environmentId);
  if (id) {
    state.interactionId = id;
  }
  if (environmentId && environmentId !== "remote") {
    state.environmentId = environmentId;
  }
}

function classify(step: Record<string, unknown>): StepState["kind"] {
  const type = String(step.type || step.kind || "").toLowerCase();
  if (type.includes("thought")) {
    return "thought";
  }
  if (
    type.includes("code") ||
    type.includes("function") ||
    type.includes("tool") ||
    type.includes("file") ||
    type.includes("execution")
  ) {
    return "tool";
  }
  if (type.includes("model") || type.includes("output") || type === "text" || type === "") {
    return "answer";
  }
  return "tool";
}

function titleFor(step: Record<string, unknown>, kind: StepState["kind"]): string {
  if (kind === "thought") {
    return "Reasoning";
  }
  if (kind === "answer") {
    return "Answer";
  }
  const command = commandOf(step);
  if (command) {
    return clip(command.replace(/^\$\s*/, ""), 88);
  }
  const name = firstString(step.name, step.tool_name, step.function, nestedName(step));
  if (name) {
    return humanize(name);
  }
  return humanize(String(step.type || "Step"));
}

function bodyFor(step: Record<string, unknown>): string {
  const command = commandOf(step);
  const text = extractText(step);
  const lines = [command, text].filter(Boolean);
  return clip(lines.join("\n").trim(), 4000);
}

function commandOf(value: Record<string, unknown>): string {
  const direct = firstString(value.command, value.code, value.cmd);
  if (direct) {
    return direct;
  }
  for (const key of ["arguments", "args", "input", "parameters"]) {
    const nested = asRecord(value[key]);
    if (!nested) {
      continue;
    }
    const found = firstString(nested.command, nested.code, nested.cmd, nested.input);
    if (found) {
      return found;
    }
  }
  return "";
}

function nestedName(step: Record<string, unknown>): string {
  const fn = asRecord(step.function);
  return fn && typeof fn.name === "string" ? fn.name : "";
}

function extractText(value: unknown): string {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return isOpaque(value) ? "" : value;
  }
  if (Array.isArray(value)) {
    return value.map(extractText).filter(Boolean).join("");
  }
  const record = asRecord(value);
  if (!record || isSignature(record)) {
    return "";
  }
  if (typeof record.text === "string" && !isOpaque(record.text)) {
    return record.text;
  }
  if (typeof record.output === "string") {
    return record.output;
  }
  if (typeof record.stdout === "string") {
    return record.stdout;
  }
  if (record.content !== undefined) {
    return extractText(record.content);
  }
  return "";
}

function isSignature(record: Record<string, unknown>): boolean {
  const type = String(record.type || "");
  return type.includes("signature") || "signature" in record || "thought_signature" in record;
}

function isOpaque(text: string): boolean {
  return text.length > 120 && !/\s/.test(text);
}

function formatUsage(value: unknown): string | undefined {
  const usage = asRecord(value);
  if (!usage) {
    return undefined;
  }
  const total = usage.total_tokens ?? usage.totalTokens;
  if (typeof total === "number") {
    return `${total.toLocaleString("en-US")} tokens`;
  }
  return undefined;
}

function humanize(value: string): string {
  const cleaned = value.replace(/[_./]+/g, " ").trim();
  if (!cleaned) {
    return "Step";
  }
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function clip(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
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
