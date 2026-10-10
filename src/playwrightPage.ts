/**
 * Reads a captured tab with Playwright's documented page API:
 * page.setContent, page.getByRole, locator.waitFor, and page.ariaSnapshot.
 * https://playwright.dev/docs/locators
 * https://playwright.dev/docs/aria-snapshots
 */
export async function snapshotHtml(html: string, pageUrl: string): Promise<{ snapshot: string; headings: number; buttons: number }> {
  const { chromium } = await import("playwright");
  const browser = await launchChrome(chromium);
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("http:") || url.startsWith("https:")) {
        return route.abort();
      }
      return route.continue();
    });
    await page.setContent(html, { waitUntil: "domcontentloaded", timeout: 15000 });
    if (pageUrl) {
      await page.evaluate((href) => {
        history.replaceState(null, "", href);
      }, pageUrl).catch(() => undefined);
    }
    const heading = page.getByRole("heading").first();
    await heading.waitFor({ state: "attached", timeout: 1500 }).catch(() => undefined);
    const snapshot = await page.ariaSnapshot();
    const headings = await page.getByRole("heading").count();
    const buttons = await page.getByRole("button").count();
    return { snapshot, headings, buttons };
  } finally {
    await browser.close();
  }
}

async function launchChrome(chromium: typeof import("playwright").chromium) {
  try {
    return await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    return chromium.launch({ channel: "msedge", headless: true });
  }
}
