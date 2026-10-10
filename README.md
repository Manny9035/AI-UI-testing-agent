# Verity

Verity is the quality engineer in the editor. It reads the code, chooses the cheapest honest test, and reports pass, fail, or blocked. A static page is judged from the files. A real runner is used only when the code requires it. Composer Fast does the analysis.

Functional testing agent for the folder you have open in VS Code.

Verity is a software quality engineering extension. You pick **Functional Testing** from the + menu in the composer, optionally add a focus, and send. Composer runs locally against that folder through the Cursor SDK, executes the cases, and shows the run as it happens: commands, narrative, and a pass / fail / blocked report.

API Testing, UI/UX Testing, Performance Testing, Security Testing, and Data & Database Testing are listed so the discipline matches the challenge. Only functional testing runs in this build.

## Run it

1. Install dependencies and build:

```bash
npm install
npm test
npm run compile
```

2. In this extension folder, create `.env` from the example and set your key. Verity reads `CURSOR_API_KEY` from that file, not from the project you open to test.

```bash
copy .env.example .env
```

3. Open this repo in VS Code, stop any debug session that is already running, and press **F5** (the **Run Verity** launch config). It compiles once, then a second window opens and stays open with no folder. Use **File → Open Folder** and choose the project you want to test, then click the Verity icon.

4. Choose **Functional Testing** with **+**, add a prompt if you want one, and press Enter.

A prompt is optional. With only the chip selected, Verity runs a functional pass over the primary behavior of the folder.

## What a run does

- Runs Composer Fast (`composer-2.5` with `fast: true`) through `@cursor/sdk` in the open folder. The agent reads the files it needs and runs a command only when the code requires it.
- Reuses the same local agent for follow-up messages.
- Asks the agent to execute cases, not to guess them, and to finish with a `verity-report` the panel renders as findings.

The **Verity** output channel logs the Composer agent id and the run id. It does not log the API key.
