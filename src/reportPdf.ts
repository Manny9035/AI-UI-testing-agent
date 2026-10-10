import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { TestCase, TestReport } from "./protocol";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const BOTTOM = 60;

const INK = rgb(0.11, 0.118, 0.133);
const MUTED = rgb(0.36, 0.38, 0.42);
const RULE = rgb(0.86, 0.875, 0.9);
const WASH = rgb(0.965, 0.969, 0.976);
const PASS = rgb(0.11, 0.42, 0.28);
const FAIL = rgb(0.67, 0.15, 0.13);
const BLOCKED = rgb(0.48, 0.37, 0.09);

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export interface ReportPdfInput {
  project: string;
  discipline: string;
  focus: string;
  generatedAt: number;
  report: TestReport;
}

interface Voice {
  lede: string;
  reading: string;
  expected: string;
  actual: string;
  improve: string;
}

export function reportFileName(discipline: string, generatedAt: number): string {
  const date = new Date(generatedAt);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return `Verity-${fileSlug(discipline)}-${day}.pdf`;
}

export async function buildReportPdf(input: ReportPdfInput): Promise<Uint8Array> {
  const discipline = input.discipline.trim() || "Testing";
  const project = input.project.trim() || "Open folder";
  const voice = voiceFor(discipline);
  const doc = await PDFDocument.create();
  doc.setTitle(`${discipline} - ${project}`);
  doc.setAuthor("Verity");
  doc.setCreator("Verity");
  doc.setSubject(voice.lede);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const sheet = new Sheet(doc, regular, bold, italic, discipline);
  sheet.start();
  drawMasthead(sheet, { ...input, discipline, project, generatedAt: input.generatedAt }, voice);
  drawSummary(sheet, input.report.summary);
  drawMetrics(sheet, input.report);
  sheet.paragraph(voice.reading, { font: italic, size: 10, color: MUTED, leading: 14 });
  sheet.gap(18);
  sheet.kicker("Findings");
  sheet.gap(8);
  input.report.cases.forEach((testCase, index) => {
    if (index > 0) {
      sheet.gap(8);
    }
    drawCase(sheet, testCase, voice);
  });
  sheet.gap(10);
  sheet.hairline();
  sheet.gap(10);
  sheet.centered("End of report");
  sheet.stamp(project);
  return doc.save();
}

function drawMasthead(sheet: Sheet, input: ReportPdfInput, voice: Voice): void {
  sheet.wordmark(formatDate(input.generatedAt));
  sheet.gap(11);
  sheet.strongRule();
  sheet.gap(20);
  sheet.kicker("Test report");
  sheet.gap(8);
  sheet.paragraph(input.discipline, { font: sheet.boldFont, size: 26, color: INK, leading: 30 });
  sheet.gap(4);
  sheet.paragraph(`${input.project}  \u00B7  Composer Fast`, {
    font: sheet.regularFont,
    size: 10,
    color: MUTED,
    leading: 14,
  });
  const focus = input.focus.trim();
  if (focus) {
    sheet.gap(12);
    sheet.kicker("Focus");
    sheet.gap(2);
    sheet.paragraph(focus, { font: sheet.italicFont, size: 11, color: INK, leading: 15 });
  }
  sheet.gap(14);
  sheet.paragraph(voice.lede, { font: sheet.italicFont, size: 11, color: MUTED, leading: 15.5 });
  sheet.gap(16);
}

function drawSummary(sheet: Sheet, summary: string): void {
  const text = summary.trim();
  if (!text) {
    return;
  }
  sheet.paragraph(text, { font: sheet.regularFont, size: 11.5, color: INK, leading: 16.5 });
  sheet.gap(16);
}

function drawMetrics(sheet: Sheet, report: TestReport): void {
  const counts = { pass: 0, fail: 0, blocked: 0 };
  for (const testCase of report.cases) {
    counts[testCase.status] += 1;
  }
  sheet.metrics([
    { count: counts.pass, label: "Passed", color: PASS },
    { count: counts.fail, label: "Failed", color: FAIL },
    { count: counts.blocked, label: "Blocked", color: BLOCKED },
  ]);
  sheet.gap(12);
}

function drawCase(sheet: Sheet, testCase: TestCase, voice: Voice): void {
  sheet.keep(176);
  sheet.continuation(testCase.id);
  sheet.hairline();
  sheet.gap(12);
  sheet.statusRow(testCase.status, testCase.id);
  sheet.gap(3);
  sheet.paragraph(testCase.title, { font: sheet.boldFont, size: 13, color: INK, leading: 18 });
  sheet.gap(8);
  sheet.field(voice.expected, testCase.expected);
  sheet.field(voice.actual, testCase.actual);
  if (testCase.improvement?.trim()) {
    sheet.callout(voice.improve, testCase.improvement, statusColor(testCase.status));
  }
  if (testCase.evidence.trim()) {
    sheet.field("Evidence", testCase.evidence, { muted: true });
  }
  sheet.continuation(null);
}

function voiceFor(discipline: string): Voice {
  const name = discipline.toLowerCase();
  if (name.includes("api")) {
    return {
      lede: "Each endpoint compared with the code that calls or serves it.",
      reading: "Hand this to the person who owns the client or the endpoint. The change is the edit that makes the code and the response agree.",
      expected: "What the code assumes",
      actual: "What the API returned",
      improve: "What to change",
    };
  }
  if (name.includes("security")) {
    return {
      lede: "How inputs and protections are implemented, and how to prevent each gap.",
      reading: "Hand this to the person who owns the code. Each finding names the protection to add.",
      expected: "Protection that should exist",
      actual: "What the code does",
      improve: "How to prevent it",
    };
  }
  return {
    lede: "What the software does, judged from the code, or from a run when the code required one.",
    reading: "Hand this to the person who owns the behavior. Passed means it holds. Failed means it does not. Blocked means it could not be judged.",
    expected: "Expected",
    actual: "Observed",
    improve: "What to change",
  };
}

function statusColor(status: TestCase["status"]): RGB {
  if (status === "pass") {
    return PASS;
  }
  if (status === "fail") {
    return FAIL;
  }
  return BLOCKED;
}

function formatDate(ms: number): string {
  const date = new Date(ms);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function fileSlug(value: string): string {
  const cleaned = value
    .replace(/[<>:"/\\|?*]+/g, " ")
    .replace(/[^\w.\- ]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "Testing";
}

function pdfSafe(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2018\u2019\u2032]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u2022/g, "-")
    .replace(/[^\n\x20-\x7E\u00B7]/g, "");
}

function wrap(value: string, font: PDFFont, size: number, width: number): string[] {
  const clean = pdfSafe(value).replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) {
    return [];
  }
  const limit = Math.max(24, width);
  const lines: string[] = [];
  for (const paragraph of clean.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      for (const piece of breakWord(word, font, size, limit)) {
        const next = line ? `${line} ${piece}` : piece;
        if (font.widthOfTextAtSize(next, size) <= limit) {
          line = next;
        } else {
          if (line) {
            lines.push(line);
          }
          line = piece;
        }
      }
    }
    if (line) {
      lines.push(line);
    }
  }
  return lines;
}

function breakWord(word: string, font: PDFFont, size: number, width: number): string[] {
  if (font.widthOfTextAtSize(word, size) <= width) {
    return [word];
  }
  const parts: string[] = [];
  let current = "";
  for (const char of word) {
    const next = current + char;
    if (current && font.widthOfTextAtSize(next, size) > width) {
      parts.push(current);
      current = char;
    } else {
      current = next;
    }
  }
  if (current) {
    parts.push(current);
  }
  return parts;
}

interface TextStyle {
  font: PDFFont;
  size: number;
  color: RGB;
  leading: number;
  width?: number;
  x?: number;
}

class Sheet {
  private page!: PDFPage;
  private y = 0;
  private caseId: string | null = null;

  constructor(
    private readonly doc: PDFDocument,
    readonly regularFont: PDFFont,
    readonly boldFont: PDFFont,
    readonly italicFont: PDFFont,
    private readonly discipline: string,
  ) {}

  start(): void {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  gap(amount: number): void {
    this.y -= amount;
  }

  keep(height: number): void {
    if (this.y - height < BOTTOM) {
      this.breakPage();
    }
  }

  continuation(id: string | null): void {
    this.caseId = id;
  }

  wordmark(date: string): void {
    this.room(14);
    const baseline = this.y - 9;
    let x = MARGIN;
    for (const char of "VERITY") {
      this.page.drawText(char, { x, y: baseline, size: 9, font: this.boldFont, color: INK });
      x += this.boldFont.widthOfTextAtSize(char, 9) + 1.45;
    }
    const stamped = pdfSafe(date);
    const width = this.regularFont.widthOfTextAtSize(stamped, 9);
    this.page.drawText(stamped, {
      x: PAGE_WIDTH - MARGIN - width,
      y: baseline,
      size: 9,
      font: this.regularFont,
      color: MUTED,
    });
    this.y -= 14;
  }

  centered(value: string): void {
    const text = pdfSafe(value);
    const size = 8;
    const width = this.regularFont.widthOfTextAtSize(text, size);
    this.room(14);
    this.page.drawText(text, {
      x: (PAGE_WIDTH - width) / 2,
      y: this.y - size,
      size,
      font: this.regularFont,
      color: MUTED,
    });
    this.y -= 14;
  }

  kicker(label: string): void {
    this.room(12);
    const baseline = this.y - 8;
    let x = MARGIN;
    const text = pdfSafe(label).toUpperCase();
    for (const char of text) {
      this.page.drawText(char, { x, y: baseline, size: 8, font: this.boldFont, color: MUTED });
      x += this.boldFont.widthOfTextAtSize(char, 8) + 0.85;
    }
    this.y -= 12;
  }

  strongRule(): void {
    this.room(2);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 1,
      color: INK,
    });
  }

  hairline(): void {
    this.room(2);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.6,
      color: RULE,
    });
  }

  paragraph(value: string, style: TextStyle): void {
    const width = style.width ?? CONTENT_WIDTH;
    const x = style.x ?? MARGIN;
    const lines = wrap(value, style.font, style.size, width);
    if (!lines.length) {
      this.paragraph("Not recorded", style);
      return;
    }
    for (const line of lines) {
      this.room(style.leading);
      if (line) {
        this.page.drawText(line, {
          x,
          y: this.y - style.size,
          size: style.size,
          font: style.font,
          color: style.color,
        });
      }
      this.y -= style.leading;
    }
  }

  field(label: string, value: string, options?: { muted?: boolean }): void {
    this.room(26);
    this.kicker(label);
    this.gap(1);
    this.paragraph(value.trim() || "Not recorded", {
      font: this.regularFont,
      size: options?.muted ? 9.5 : 10.5,
      color: options?.muted ? MUTED : INK,
      leading: options?.muted ? 13 : 15,
    });
    this.gap(8);
  }

  callout(label: string, value: string, accent: RGB): void {
    const padX = 14;
    const padTop = 12;
    const inner = CONTENT_WIDTH - padX * 2;
    const bodyLines = wrap(value, this.regularFont, 10.5, inner);
    const lines = bodyLines.length ? bodyLines : ["Not recorded"];
    const bodyLeading = 15;
    const height = padTop + 12 + 6 + lines.length * bodyLeading + 12;
    if (height > this.pageBudget()) {
      this.field(label, value);
      return;
    }
    if (this.y - height < BOTTOM) {
      this.breakPage();
    }
    const top = this.y;
    const bottom = top - height;
    this.page.drawRectangle({
      x: MARGIN,
      y: bottom,
      width: CONTENT_WIDTH,
      height,
      color: WASH,
    });
    this.page.drawRectangle({
      x: MARGIN,
      y: bottom,
      width: 2.5,
      height,
      color: accent,
    });
    let cursor = top - padTop - 8;
    let labelX = MARGIN + padX;
    for (const char of pdfSafe(label).toUpperCase()) {
      this.page.drawText(char, { x: labelX, y: cursor, size: 8, font: this.boldFont, color: MUTED });
      labelX += this.boldFont.widthOfTextAtSize(char, 8) + 0.85;
    }
    cursor -= 16;
    for (const line of lines) {
      if (line) {
        this.page.drawText(line, {
          x: MARGIN + padX,
          y: cursor,
          size: 10.5,
          font: this.regularFont,
          color: INK,
        });
      }
      cursor -= bodyLeading;
    }
    this.y = bottom - 12;
  }

  statusRow(status: TestCase["status"], id: string): void {
    this.room(16);
    const color = statusColor(status);
    const word = status === "pass" ? "Passed" : status === "fail" ? "Failed" : "Blocked";
    const baseline = this.y - 10;
    this.page.drawCircle({ x: MARGIN + 3, y: baseline + 3, size: 3, color });
    this.page.drawText(word, { x: MARGIN + 12, y: baseline, size: 10, font: this.boldFont, color });
    const safeId = pdfSafe(id);
    const width = this.regularFont.widthOfTextAtSize(safeId, 9);
    this.page.drawText(safeId, {
      x: PAGE_WIDTH - MARGIN - width,
      y: baseline,
      size: 9,
      font: this.regularFont,
      color: MUTED,
    });
    this.y -= 16;
  }

  metrics(items: Array<{ count: number; label: string; color: RGB }>): void {
    const height = 68;
    this.room(height);
    const top = this.y;
    const bottom = top - height;
    this.page.drawRectangle({
      x: MARGIN,
      y: bottom,
      width: CONTENT_WIDTH,
      height,
      color: WASH,
    });
    const column = CONTENT_WIDTH / items.length;
    items.forEach((item, index) => {
      const center = MARGIN + column * index + column / 2;
      const num = String(item.count);
      const numWidth = this.boldFont.widthOfTextAtSize(num, 22);
      this.page.drawText(num, {
        x: center - numWidth / 2,
        y: bottom + 28,
        size: 22,
        font: this.boldFont,
        color: item.color,
      });
      const label = item.label.toUpperCase();
      const labelWidth = this.boldFont.widthOfTextAtSize(label, 8);
      this.page.drawText(label, {
        x: center - labelWidth / 2,
        y: bottom + 14,
        size: 8,
        font: this.boldFont,
        color: MUTED,
      });
      if (index > 0) {
        const x = MARGIN + column * index;
        this.page.drawLine({
          start: { x, y: bottom + 16 },
          end: { x, y: top - 16 },
          thickness: 0.6,
          color: RULE,
        });
      }
    });
    this.y = bottom;
  }

  stamp(project: string): void {
    const pages = this.doc.getPages();
    const total = String(pages.length);
    pages.forEach((page, index) => {
      page.drawLine({
        start: { x: MARGIN, y: 36 },
        end: { x: PAGE_WIDTH - MARGIN, y: 36 },
        thickness: 0.6,
        color: RULE,
      });
      page.drawText("Verity", { x: MARGIN, y: 22, size: 8, font: this.boldFont, color: MUTED });
      const right = `${index + 1}  /  ${total}`;
      const rightWidth = this.regularFont.widthOfTextAtSize(right, 8);
      page.drawText(right, {
        x: PAGE_WIDTH - MARGIN - rightWidth,
        y: 22,
        size: 8,
        font: this.regularFont,
        color: MUTED,
      });
      const center = pdfSafe(project);
      const centerWidth = this.regularFont.widthOfTextAtSize(center, 8);
      const centerX = PAGE_WIDTH / 2 - centerWidth / 2;
      const leftEdge = MARGIN + this.boldFont.widthOfTextAtSize("Verity", 8) + 18;
      const rightEdge = PAGE_WIDTH - MARGIN - rightWidth - 18;
      if (center && centerX > leftEdge && centerX + centerWidth < rightEdge) {
        page.drawText(center, { x: centerX, y: 22, size: 8, font: this.regularFont, color: MUTED });
      }
    });
  }

  private room(height: number): void {
    if (this.y - height < BOTTOM) {
      this.breakPage();
    }
  }

  private pageBudget(): number {
    return PAGE_HEIGHT - MARGIN - 36 - BOTTOM;
  }

  private breakPage(): void {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
    const baseline = this.y - 9;
    this.page.drawText("VERITY", { x: MARGIN, y: baseline, size: 8, font: this.boldFont, color: INK });
    const label = pdfSafe(this.discipline);
    const width = this.regularFont.widthOfTextAtSize(label, 9);
    this.page.drawText(label, {
      x: PAGE_WIDTH - MARGIN - width,
      y: baseline,
      size: 9,
      font: this.regularFont,
      color: MUTED,
    });
    this.y -= 16;
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: PAGE_WIDTH - MARGIN, y: this.y },
      thickness: 0.6,
      color: RULE,
    });
    this.y -= 16;
    if (this.caseId) {
      const label = `${pdfSafe(this.caseId)} continued`;
      this.page.drawText(label, {
        x: MARGIN,
        y: this.y - 9,
        size: 9,
        font: this.italicFont,
        color: MUTED,
      });
      this.y -= 16;
    }
    this.y -= 4;
  }
}
