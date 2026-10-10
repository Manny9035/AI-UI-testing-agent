import { writeFileSync } from "fs";
import path from "path";
import { webviewDocument } from "./html";

const html = webviewDocument({
  nonce: "preview",
  cspSource: "'self'",
  styleUri: "../media/webview.css",
  scriptUri: "./webview.js",
  preview: true,
});

writeFileSync(path.join(__dirname, "preview.html"), html);
