import { DISCIPLINES } from "./disciplines";

export function webviewDocument(options: {
  nonce: string;
  cspSource: string;
  styleUri: string;
  scriptUri: string;
  preview?: boolean;
}): string {
  const disciplines = JSON.stringify(DISCIPLINES).replace(/</g, "\\u003c");
  const csp = options.preview
    ? "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:;"
    : [
        "default-src 'none'",
        `style-src ${options.cspSource}`,
        `script-src 'nonce-${options.nonce}'`,
        `img-src ${options.cspSource} data:`,
      ].join("; ");
  const previewScripts = options.preview
    ? `<script src="previewBoot.js"></script>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <link rel="stylesheet" href="${options.styleUri}" />
  <title>Verity</title>
</head>
<body>
  <div class="shell">
    <div class="progress" id="progress" aria-hidden="true"><span></span></div>
    <header class="top">
      <div class="brand-row">
        <div class="brand">
          <div class="mark" aria-hidden="true"><span>V</span></div>
          <div>
            <div class="brand-name">Verity</div>
            <div class="brand-kicker">Software quality engineering</div>
          </div>
        </div>
        <button type="button" class="text-button" id="new-session">New session</button>
      </div>
      <div class="pills">
        <span class="pill" id="workspace-pill">No folder open</span>
        <span class="pill" id="sandbox-pill">No sandbox</span>
      </div>
    </header>
    <div class="keybar" id="keybar" hidden>
      <p>Add <strong>GEMINI_API_KEY</strong> to the <strong>.env</strong> file in this folder. It stays on your machine.</p>
      <button type="button" class="text-button" id="open-env">Open .env</button>
    </div>
    <main class="transcript" id="transcript" aria-live="polite"></main>
    <footer class="dock">
      <p class="notice" id="notice" hidden></p>
      <form class="composer" id="composer">
        <div class="menu" id="menu" role="menu" hidden></div>
        <div class="chips" id="chips"></div>
        <label class="sr-only" for="draft">Message</label>
        <textarea id="draft" rows="1" placeholder="Ask Verity to test this project"></textarea>
        <div class="bar">
          <button type="button" class="plus" id="plus" aria-haspopup="menu" aria-expanded="false" aria-label="Choose a testing discipline">+</button>
          <span class="hint" id="hint">Use + to choose a discipline</span>
          <button type="submit" class="send" id="send" aria-label="Send" disabled>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M7.2 13V5.7L4.1 8.8 3 7.7 8 2.7l5 5-1.1 1.1-3.1-3.1V13H7.2Z"/></svg>
          </button>
        </div>
      </form>
      <p class="footnote">This folder is copied into a Gemini sandbox. The key in .env stays here.<span id="agent-name"></span></p>
    </footer>
  </div>
  <script nonce="${options.nonce}" id="disciplines" type="application/json">${disciplines}</script>
  ${previewScripts}
  <script nonce="${options.nonce}" src="${options.scriptUri}"></script>
</body>
</html>`;
}
