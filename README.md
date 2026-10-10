# Verity

Functional testing agent for the folder you have open in VS Code.

Verity is a software quality engineering extension. You pick **Functional Testing** from the + menu in the composer, optionally add a focus, and send. The extension copies the open project into a Gemini managed sandbox, asks the Antigravity agent to design and execute functional cases, and shows the run as it happens: commands, narrative, and a pass / fail / blocked report.

API Testing, UI/UX Testing, Performance Testing, Security Testing, and Data & Database Testing are listed so the discipline matches the challenge. Only functional testing runs in this build.

## Run it

1. Install dependencies and build:

```bash
npm install
npm test
npm run compile
```

2. In the folder you have open, create `.env` from the example and set your key. Verity reads `GEMINI_API_KEY` from that file and does not upload it.

```bash
copy .env.example .env
```

3. Open this repo in VS Code and press **F5** (the **Run Verity** launch config). In the Extension Development Host, open the project you want to test, then click the Verity icon in the activity bar.

4. Choose **Functional Testing** with **+**, add a prompt if you want one, and press Enter.

A prompt is optional. With only the chip selected, Verity runs a functional pass over the primary behavior of the folder.

## What a run does

- Packs source from the open folder, skipping `node_modules`, build output, secrets, and `.env`.
- Provisions a remote sandbox with Gemini's Interactions API (`antigravity-preview-09-2026`) and uploads the project.
- Reuses that sandbox for follow-up messages, and uploads again when files change.
- Asks the agent to execute cases, not to guess them, and to finish with a `verity-report` the panel renders as findings.

The **Verity** output channel logs sandbox phases and HTTP status. It does not log the API key.
