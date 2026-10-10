import { gzipSync } from "zlib";

export interface TarFile {
  name: string;
  data: Buffer;
}

/**
 * POSIX ustar + gzip. Paths use forward slashes.
 * Names longer than 100 bytes are split into the ustar prefix.
 */
export function createTarGz(files: TarFile[]): Buffer {
  const chunks: Buffer[] = [];
  for (const file of files) {
    const { name, prefix } = splitTarName(file.name);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, "utf8");
    writeOctal(header, 100, 8, 0o644);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, file.data.length);
    writeOctal(header, 136, 12, Math.floor(Date.now() / 1000));
    header.write("        ", 148, 8, "ascii");
    header[156] = "0".charCodeAt(0);
    header.write("ustar", 257, 5, "ascii");
    header.write("00", 263, 2, "ascii");
    if (prefix) {
      header.write(prefix, 345, 155, "utf8");
    }
    let sum = 0;
    for (let i = 0; i < 512; i++) {
      sum += header[i];
    }
    const checksum = sum.toString(8).padStart(6, "0");
    header.write(checksum, 148, 6, "ascii");
    header[154] = 0;
    header[155] = 32;
    chunks.push(header, file.data);
    const remainder = file.data.length % 512;
    if (remainder !== 0) {
      chunks.push(Buffer.alloc(512 - remainder));
    }
  }
  chunks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(chunks));
}

function writeOctal(header: Buffer, offset: number, length: number, value: number): void {
  const digits = length - 1;
  const text = value.toString(8).padStart(digits, "0");
  if (text.length > digits) {
    throw new Error(`tar field overflow at ${offset}`);
  }
  header.write(text, offset, digits, "ascii");
  header[offset + digits] = 0;
}

export function splitTarName(raw: string): { name: string; prefix: string } {
  const normalized = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("\0")) {
    throw new Error(`invalid tar path: ${raw}`);
  }
  if (Buffer.byteLength(normalized) <= 100) {
    return { name: normalized, prefix: "" };
  }
  const bytes = Buffer.from(normalized);
  // Leave the filename in `name` and the directories in `prefix`.
  const slash = normalized.lastIndexOf("/");
  if (slash <= 0) {
    throw new Error(`path too long for ustar: ${normalized}`);
  }
  const prefix = normalized.slice(0, slash);
  const name = normalized.slice(slash + 1);
  if (Buffer.byteLength(prefix) > 155 || Buffer.byteLength(name) > 100) {
    // Walk back to a slash that satisfies both limits.
    let cut = bytes.length - 100;
    while (cut < bytes.length && bytes[cut] !== 0x2f) {
      cut++;
    }
    if (bytes[cut] !== 0x2f || cut > 155 || bytes.length - cut - 1 > 100) {
      throw new Error(`path too long for ustar: ${normalized}`);
    }
    return {
      prefix: bytes.subarray(0, cut).toString("utf8"),
      name: bytes.subarray(cut + 1).toString("utf8"),
    };
  }
  return { name, prefix };
}
