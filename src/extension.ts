import * as vscode from "vscode";
import { VerityViewProvider } from "./viewProvider";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new VerityViewProvider(context);
  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(VerityViewProvider.viewId, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("verity.focus", () => {
      void vscode.commands.executeCommand("verity.agent.focus");
    }),
    vscode.commands.registerCommand("verity.newSession", () => {
      void provider.newSession();
    }),
    vscode.commands.registerCommand("verity.configureKey", () => {
      void provider.openEnvFile();
    }),
  );
}

export function deactivate(): void {
  // The provider disposes its output channel and file watcher.
}
