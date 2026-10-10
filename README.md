# NextOps

NextOps is the quality engineer in the editor. It reads the code, chooses the cheapest honest test, and reports pass, fail, or blocked. A static page is judged from the files. A real runner is used only when the code requires it. Composer Fast does the analysis.

Functional testing agent for the folder you have open in VS Code.

NextOps is a software quality engineering extension. You pick **Functional Testing** from the + menu in the composer, optionally add a focus, and send. Composer runs locally against that folder through the Cursor SDK, executes the cases, and shows the run as it happens: commands, narrative, and a pass / fail / blocked report.

API Testing calls the endpoint, compares the response with the code, and says what to change so they match. Security Testing reviews how inputs and protections are implemented and recommends how to prevent each gap. UI/UX Testing, Performance Testing, and Data & Database Testing are listed and not wired yet.

When a run has findings, **Download PDF** saves a report for the discipline that was selected. It has the summary, the pass / fail / blocked counts, and each finding with what was expected, what was found, and the change to hand over.

## Check a website

Testers who are not working in the editor use the browser side panel. It sits on the right of the site they already have open.

1. Build, then start the helper in this folder so Composer Fast can tighten the wording and, when `POSTMAN_API_KEY` is set, save API calls to Postman:

```bash
npm run compile
npm run browser
```

2. In Chrome, open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select the `browser` folder.

3. Open the website to check and click the NextOps icon. The panel opens on the right. Choose **Functional testing**, **API testing**, or **Security testing**, add a note if you want one, and press **Check**. **Download PDF** saves the same handoff as the editor.

Functional testing moves through the open tab, then Playwright reads that page with [`getByRole`](https://playwright.dev/docs/locators) and an [aria snapshot](https://playwright.dev/docs/aria-snapshots). API testing calls the GET requests the page makes and can store the collection with the [Postman API](https://learning.postman.com/docs/reference/postman-api/authentication). Security testing reviews the connection, cookies, and inputs. It does not attack the page. The result still stands if the helper is not running; Composer Fast and Postman are used when they are configured.

## Run it

1. Install dependencies and build:

```bash
npm install
npm test
npm run compile
```

2. In this extension folder, create `.env` from the example and set your key. NextOps reads `CURSOR_API_KEY` from that file, not from the project you open to test.

```bash
copy .env.example .env
```

3. Open this repo in VS Code, stop any debug session that is already running, and press **F5** (the **Run NextOps** launch config). It compiles once, then a second window opens and stays open with no folder. Use **File → Open Folder** and choose the project you want to test, then click the NextOps icon.

4. Choose **Functional Testing** with **+**, add a prompt if you want one, and press Enter.

A prompt is optional. With only the chip selected, NextOps runs a functional pass over the primary behavior of the folder.

## What a run does

- Runs Composer Fast (`composer-2.5` with `fast: true`) through `@cursor/sdk` in the open folder. The agent reads the files it needs and runs a command only when the code requires it.
- Reuses the same local agent for follow-up messages.
- Asks the agent to execute cases, not to guess them, and to finish with a `verity-report` the panel renders as findings.

The **NextOps** output channel logs the Composer agent id and the run id. It does not log the API key.
