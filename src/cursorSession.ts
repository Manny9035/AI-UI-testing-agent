import {
  Agent,
  AgentNotFoundError,
  AuthenticationError,
  Cursor,
  CursorAgentError,
  JsonlLocalAgentStore,
  RateLimitError,
  type ModelSelection,
  type Run,
  type SDKAgent,
  type SDKMessage,
  type SettingSource,
  type ToolName,
} from "@cursor/sdk";
import { COMPOSER_MODEL_ID } from "./prompt";

const DISALLOWED_TOOLS: ToolName[] = ["edit", "delete", "applyAgentDiff"];
const SETTING_SOURCES: SettingSource[] = [];

let composerModel: ModelSelection | undefined;

export class Stopped extends Error {
  constructor() {
    super("Stopped.");
    this.name = "Stopped";
  }
}

export class CursorSession {
  private constructor(
    readonly agent: SDKAgent,
    private readonly model: ModelSelection,
  ) {}

  get agentId(): string {
    return this.agent.agentId;
  }

  static async open(options: {
    apiKey: string;
    cwd: string;
    store: JsonlLocalAgentStore;
    agentId?: string;
  }): Promise<CursorSession> {
    const model = await resolveComposer(options.apiKey);
    const createOptions = {
      apiKey: options.apiKey,
      name: "Verity",
      model,
      disallowedTools: DISALLOWED_TOOLS,
      local: {
        cwd: options.cwd,
        store: options.store,
        settingSources: SETTING_SOURCES,
      },
    };
    if (options.agentId) {
      try {
        return new CursorSession(await Agent.resume(options.agentId, createOptions), model);
      } catch (error) {
        if (!(error instanceof AgentNotFoundError)) {
          throw error;
        }
      }
    }
    return new CursorSession(await Agent.create(createOptions), model);
  }

  async send(
    input: string,
    handlers: {
      signal: AbortSignal;
      onEvent: (event: SDKMessage) => void;
    },
  ): Promise<Awaited<ReturnType<Run["wait"]>>> {
    const run = await this.agent.send(input, { model: this.model, local: { force: true } });
    const onAbort = () => {
      if (run.supports("cancel")) {
        void run.cancel();
      }
    };
    if (handlers.signal.aborted) {
      onAbort();
    } else {
      handlers.signal.addEventListener("abort", onAbort, { once: true });
    }
    const streaming = (async () => {
      if (!run.supports("stream")) {
        return;
      }
      for await (const event of run.stream()) {
        handlers.onEvent(event);
      }
    })();
    try {
      const result = await run.wait();
      await streaming.catch((error: unknown) => {
        if (result.status !== "cancelled" && !isAbort(error)) {
          throw error;
        }
      });
      return result;
    } catch (error) {
      await streaming.catch(() => undefined);
      throw error;
    } finally {
      handlers.signal.removeEventListener("abort", onAbort);
    }
  }

  async close(): Promise<void> {
    await this.agent[Symbol.asyncDispose]();
  }
}

export async function openAgentStore(directory: string): Promise<JsonlLocalAgentStore> {
  return new JsonlLocalAgentStore(directory);
}

export function explainCursorError(error: unknown): Error {
  if (error instanceof Stopped) {
    return error;
  }
  if (
    error instanceof AuthenticationError ||
    (error instanceof CursorAgentError && (error.status === 401 || error.status === 403))
  ) {
    return new Error("Cursor rejected the API key. Check CURSOR_API_KEY in the Verity folder .env file.");
  }
  if (error instanceof RateLimitError || (error instanceof CursorAgentError && error.status === 429)) {
    return new Error("This Cursor key is out of usage. Check the Cursor usage dashboard, then send again.");
  }
  if (error instanceof CursorAgentError) {
    const retry = error.isRetryable ? " Send again." : "";
    return new Error(`${error.message}${retry}`);
  }
  if (isAbort(error)) {
    return error instanceof Error ? error : new Stopped();
  }
  if (error instanceof Error) {
    return error;
  }
  return new Error("The run failed.");
}

export async function resolveComposer(apiKey: string): Promise<ModelSelection> {
  if (composerModel) {
    return composerModel;
  }
  const models = await Cursor.models.list({ apiKey });
  const composer = models.find((model) => model.id === COMPOSER_MODEL_ID);
  if (!composer) {
    throw new Error("Composer 2.5 is not available for this Cursor API key.");
  }
  const fastVariant = composer.variants?.find((variant) =>
    variant.params.some((param) => param.id === "fast" && param.value === "true"),
  );
  if (fastVariant) {
    composerModel = { id: composer.id, params: fastVariant.params };
    return composerModel;
  }
  const fast = composer.parameters?.find((parameter) => parameter.id === "fast");
  const fastValue = fast?.values.find((item) => item.value === "true")?.value;
  if (!fast || !fastValue) {
    throw new Error("Composer Fast is not available for this Cursor API key.");
  }
  composerModel = { id: composer.id, params: [{ id: fast.id, value: fastValue }] };
  return composerModel;
}

export function isAbort(error: unknown): boolean {
  if (error instanceof Stopped) {
    return true;
  }
  return error instanceof Error && error.name === "AbortError";
}

export function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || /timeout/i.test(error.message));
}
