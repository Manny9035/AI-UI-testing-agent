from pathlib import Path

from playwright.async_api import async_playwright

from app.observer.ui_observer import observe_page

from app.executor.action_executor import execute_action


SCREENSHOT_DIRECTORY = Path("screenshots")

SCREENSHOT_DIRECTORY.mkdir(
    parents=True,
    exist_ok=True
)


async def inspect_website(url: str) -> dict:
    

    async with async_playwright() as playwright:

        browser = await playwright.chromium.launch(
            headless=True
        )

        page = await browser.new_page(
            viewport={
                "width": 1440,
                "height": 900
            }
        )

        try:
            # -----------------------------------------
            # 1. OPEN THE WEBSITE
            # -----------------------------------------

            response = await page.goto(
                url,
                wait_until="domcontentloaded",
                timeout=30000
            )

            # Give JavaScript applications time
            # to finish rendering.
            try:
                await page.wait_for_load_state(
                    "networkidle",
                    timeout=10000
                )
            except Exception:
                # Some websites continuously make
                # network requests.
                pass

            # Extra time for React/client-side rendering.
            await page.wait_for_timeout(2000)

            # -----------------------------------------
            # 2. OBSERVE THE PAGE
            # -----------------------------------------

            title = await page.title()

            visible_text = await page.locator(
                "body"
            ).inner_text()

            # -----------------------------------------
            # 3. TAKE SCREENSHOT
            # -----------------------------------------

            screenshot_path = (
                SCREENSHOT_DIRECTORY / "latest.png"
            )

            await page.screenshot(
                path=str(screenshot_path),
                full_page=True
            )

            # -----------------------------------------
            # 4. EXTRACT UI ELEMENTS
            # -----------------------------------------

            ui_elements = await observe_page(page)

            # -----------------------------------------
            # 5. RETURN OBSERVATION
            # -----------------------------------------

            return {
                "title": title,
                "url": page.url,
                "status_code": (
                    response.status
                    if response
                    else None
                ),
                "visible_text": visible_text[:5000],
                "screenshot": str(screenshot_path),
                "ui": ui_elements,
            }

        finally:
            await browser.close()

async def test_manual_interaction(
    url: str,
) -> dict:

    async with async_playwright() as playwright:

        browser = await playwright.chromium.launch(
            headless=True
        )

        page = await browser.new_page(
            viewport={
                "width": 1440,
                "height": 900
            }
        )

        try:

            await page.goto(
                url,
                wait_until="domcontentloaded",
                timeout=30000
            )

            try:
                await page.wait_for_load_state(
                    "networkidle",
                    timeout=10000
                )
            except Exception:
                pass

            await page.wait_for_timeout(2000)

            # Observe first.
            before = await observe_page(page)

            # For our Spartans test,
            # input_0 should be the email field.
            action_result = await execute_action(
                page=page,
                action="fill",
                target="input_0",
                value="test@example.com",
            )

            await page.wait_for_timeout(500)

            screenshot_path = (
                SCREENSHOT_DIRECTORY /
                "interaction_test.png"
            )

            await page.screenshot(
                path=str(screenshot_path),
                full_page=True
            )

            # Observe again.
            after = await observe_page(page)

            return {
                "before": before,
                "action": action_result,
                "after": after,
                "screenshot": str(
                    screenshot_path
                ),
            }

        finally:
            await browser.close()
            