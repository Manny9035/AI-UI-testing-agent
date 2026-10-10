import { createHash } from "crypto";
import { lstat, readdir, readFile } from "fs/promises";
import path from "path";
import { createTarGz } from "./tar";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "out",
  "build",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
  ".next",
  ".turbo",
  ".cache",
  "screenshots",
  "agent-tools",
  ".idea",
  ".vscode",
]);

const SKIP_FILES = new Set([
  ".env",
  ".env.local",
  ".env.development",
  ".env.production",
  ".npmrc",
  ".pypirc",
]);

const SKIP_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".7z",
  ".woff",
  ".woff2",
  ".mp4",
  ".mp3",
  ".wav",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".pem",
  ".key",
  ".p12",
  ".pfx",
  ".map",
  ".vsix",
]);

const LOCKFILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "cargo.lock",
  "composer.lock",
  "gemfile.lock",
]);

const MAX_FILE_BYTES = 180_000;
const MAX_TOTAL_BYTES = 3_000_000;
const MAX_FILES = 200;

export interface PackedFile {
  path: string;
  bytes: number;
}

export interface PackedWorkspace {
  files: PackedFile[];
  archive: Buffer;
  fingerprint: string;
  skippedEnv: boolean;
}

interface Candidate {
  rel: string;
  full: string;
  size: number;
  mtimeMs: number;
  priority: number;
}

export function shouldSkipPath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").includes("..")) {
    return true;
  }
  const parts = normalized.split("/");
  if (parts.some((part) => SKIP_DIRS.has(part))) {
    return true;
  }
  const base = parts[parts.length - 1].toLowerCase();
  if (SKIP_FILES.has(base) || base.startsWith(".env")) {
    return true;
  }
  if (LOCKFILES.has(base)) {
    return true;
  }
  const ext = path.posix.extname(base);
  if (SKIP_EXT.has(ext)) {
    return true;
  }
  if (base.endsWith(".min.js")) {
    return true;
  }
  return false;
}

export function priorityFor(relPath: string): number {
  const normalized = relPath.replace(/\\/g, "/").toLowerCase();
  const base = path.posix.basename(normalized);
  if (
    ["package.json", "pyproject.toml", "requirements.txt", "go.mod", "cargo.toml", "composer.json", "readme.md"].includes(
      base,
    )
  ) {
    return 100;
  }
  if (/(^|\/)(test|tests|__tests__|spec)\//.test(normalized) || /\.(test|spec)\.[a-z0-9]+$/.test(normalized)) {
    return 80;
  }
  if (/(^|\/)(src|app|pages|routes|api|lib|server|backend|frontend)\//.test(normalized)) {
    return 60;
  }
  return 40;
}

export async function packWorkspace(root: string): Promise<PackedWorkspace> {
  const candidates: Candidate[] = [];
  let skippedEnv = false;
  await walk(root, root, candidates, (rel) => {
    if (path.posix.basename(rel).toLowerCase().startsWith(".env")) {
      skippedEnv = true;
    }
  });
  candidates.sort((a, b) => b.priority - a.priority || a.rel.localeCompare(b.rel));

  const chosen: { rel: string; data: Buffer; mtimeMs: number }[] = [];
  let total = 0;
  for (const candidate of candidates) {
    if (chosen.length >= MAX_FILES || total >= MAX_TOTAL_BYTES) {
      break;
    }
    if (candidate.size > MAX_FILE_BYTES) {
      continue;
    }
    const data = await readFile(candidate.full);
    if (data.includes(0)) {
      continue;
    }
    if (total + data.length > MAX_TOTAL_BYTES) {
      continue;
    }
    chosen.push({ rel: candidate.rel, data, mtimeMs: candidate.mtimeMs });
    total += data.length;
  }
  chosen.sort((a, b) => a.rel.localeCompare(b.rel));

  const fingerprint = createHash("sha256")
    .update(chosen.map((file) => `${file.rel}:${file.data.length}:${file.mtimeMs}`).join("\n"))
    .digest("hex");

  return {
    files: chosen.map((file) => ({ path: file.rel, bytes: file.data.length })),
    archive: createTarGz(chosen.map((file) => ({ name: file.rel, data: file.data }))),
    fingerprint,
    skippedEnv,
  };
}

async function walk(
  root: string,
  current: string,
  into: Candidate[],
  onSkipped: (rel: string) => void,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const full = path.join(current, entry.name);
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      await walk(root, full, into, onSkipped);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (shouldSkipPath(rel)) {
      onSkipped(rel);
      continue;
    }
    let stat;
    try {
      stat = await lstat(full);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size === 0) {
      continue;
    }
    into.push({
      rel,
      full,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      priority: priorityFor(rel),
    });
  }
}
