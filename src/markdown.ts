/** Escape, then apply a small markdown subset. Model text cannot inject HTML. */
export function renderMarkdown(raw: string): string {
  const escaped = escapeHtml(raw.replace(/\r\n/g, "\n").trim());
  if (!escaped) {
    return "";
  }
  const chunks: string[] = [];
  const fence = /```([^\n`]*)\n([\s\S]*?)```/g;
  let cursor = 0;
  for (const match of escaped.matchAll(fence)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      chunks.push(renderBlocks(escaped.slice(cursor, index)));
    }
    chunks.push(`<pre><code>${match[2]}</code></pre>`);
    cursor = index + match[0].length;
  }
  if (cursor < escaped.length) {
    chunks.push(renderBlocks(escaped.slice(cursor)));
  }
  return chunks.join("");
}

function renderBlocks(source: string): string {
  const lines = source.split("\n");
  const html: string[] = [];
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) {
      html.push(list === "ul" ? "</ul>" : "</ol>");
      list = null;
    }
  };
  for (const line of lines) {
    const heading = /^(#{1,3}) (.+)$/.exec(line);
    const bullet = /^[-*] (.+)$/.exec(line);
    const numbered = /^\d+\. (.+)$/.exec(line);
    if (!line.trim()) {
      closeList();
      continue;
    }
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (bullet) {
      if (list !== "ul") {
        closeList();
        html.push("<ul>");
        list = "ul";
      }
      html.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }
    if (numbered) {
      if (list !== "ol") {
        closeList();
        html.push("<ol>");
        list = "ol";
      }
      html.push(`<li>${inline(numbered[1])}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  return html.join("");
}

function inline(value: string): string {
  return value
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
