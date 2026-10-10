import * as vscode from "vscode";
import { NextOpsViewProvider } from "./viewProvider";

export function activate(context: vscode.ExtensionContext): void {
  const provider = new NextOpsViewProvider(context);
  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(NextOpsViewProvider.viewId, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("nextops.focus", () => {
      void vscode.commands.executeCommand("nextops.agent.focus");
    }),
    vscode.commands.registerCommand("nextops.newSession", () => {
      void provider.newSession();
    }),
    vscode.commands.registerCommand("nextops.configureKey", () => {
      void provider.openEnvFile();
    }),
  );
}

export function deactivate(): void {
  // The provider disposes its output channel and file watcher.
}
