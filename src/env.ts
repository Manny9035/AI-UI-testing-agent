import { existsSync, readFileSync } from "fs";
import path from "path";

const KEY_NAMES = ["GEMINI_API_KEY", "GOOGLE_API_KEY"];

/** Read a local env file without printing values. Quoted values are unwrapped. */
export function readKeyFromEnvFile(filePath: string): string | undefined {
  if (!existsSync(filePath)) {
    return undefined;
  }
  let text = "";
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const name = trimmed.slice(0, eq).trim();
    if (!KEY_NAMES.includes(name)) {
      continue;
    }
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function resolveApiKey(workspaceRoot: string | undefined): string | undefined {
  if (workspaceRoot) {
    const fromFile = readKeyFromEnvFile(path.join(workspaceRoot, ".env"));
    if (fromFile) {
      return fromFile;
    }
  }
  for (const name of KEY_NAMES) {
    const value = process.env[name];
    if (value) {
      return value;
    }
  }
  return undefined;
}
