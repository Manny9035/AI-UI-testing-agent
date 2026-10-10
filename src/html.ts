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
    ? `<style>
    :root {
      color-scheme: dark;
      --vscode-font-family: "Segoe UI", system-ui, sans-serif;
      --vscode-font-size: 13px;
      --vscode-editor-font-family: Consolas, "Segoe UI Mono", monospace;
      --vscode-foreground: #cccccc;
      --vscode-descriptionForeground: #9d9d9d;
      --vscode-disabledForeground: #656565;
      --vscode-sideBar-background: #181818;
      --vscode-input-background: #313131;
      --vscode-input-foreground: #cccccc;
      --vscode-input-border: #3c3c3c;
      --vscode-input-placeholderForeground: #989898;
      --vscode-focusBorder: #0078d4;
      --vscode-button-background: #0078d4;
      --vscode-button-foreground: #ffffff;
      --vscode-button-hoverBackground: #026ec1;
      --vscode-toolbar-hoverBackground: rgba(255, 255, 255, 0.08);
      --vscode-list-hoverBackground: rgba(255, 255, 255, 0.06);
      --vscode-list-activeSelectionBackground: rgba(255, 255, 255, 0.1);
      --vscode-widget-border: #2b2b2b;
      --vscode-badge-background: #4d4d4d;
      --vscode-badge-foreground: #ffffff;
      --vscode-textCodeBlock-background: #2b2b2b;
      --vscode-editorWidget-background: #202020;
      --vscode-editorWidget-border: #454545;
      --vscode-widget-shadow: rgba(0, 0, 0, 0.36);
      --vscode-scrollbarSlider-background: rgba(121, 121, 121, 0.4);
      --vscode-progressBar-background: #0078d4;
      --vscode-testing-iconPassed: #73c991;
      --vscode-testing-iconFailed: #f14c4c;
      --vscode-testing-iconSkipped: #cca700;
      --vscode-errorForeground: #f48771;
      --vscode-inputValidation-warningBackground: #352a05;
      --vscode-inputValidation-warningBorder: #cca700;
    }
    </style><script src="previewBoot.js"></script>`
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
      <div class="meta">
        <span class="pill" id="workspace-pill">No folder open</span>
        <span class="pill" id="sandbox-pill">No sandbox</span>
      </div>
      <button type="button" class="text-button" id="new-session">New</button>
    </header>
    <div class="keybar" id="keybar" hidden>
      <p>Add <strong>GEMINI_API_KEY</strong> to the <strong>.env</strong> file in the Verity folder. The project you open is not where the key is read from.</p>
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
      <p class="footnote"><span id="agent-name"></span></p>
    </footer>
  </div>
  <script nonce="${options.nonce}" id="disciplines" type="application/json">${disciplines}</script>
  ${previewScripts}
  <script nonce="${options.nonce}" src="${options.scriptUri}"></script>
</body>
</html>`;
}
