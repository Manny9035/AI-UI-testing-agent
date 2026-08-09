from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from playwright.async_api import (
    Browser,
    BrowserContext,
    Page,
    Playwright,
    async_playwright,
)

from app.executor.action_executor import execute_action
from app.observer.ui_observer import observe_page


SCREENSHOT_DIRECTORY = Path("screenshots")

SCREENSHOT_DIRECTORY.mkdir(
    parents=True,
    exist_ok=True,
)


@dataclass
class BrowserSession:
    """
    Represents one active website testing session.
    """

    session_id: str
    goal: str

    playwright: Playwright
    browser: Browser
    context: BrowserContext
    page: Page

    step: int = 0


class SessionManager:
    """
    Creates, stores, retrieves, and closes
    active browser testing sessions.
    """

    def __init__(self):
        self.sessions: dict[str, BrowserSession] = {}


    async def create_session(
        self,
        url: str,
        goal: str,
    ) -> dict:

        playwright = await async_playwright().start()

        browser = await playwright.chromium.launch(
            headless=True
        )

        context = await browser.new_context(
            viewport={
                "width": 1440,
                "height": 900,
            }
        )

        page = await context.new_page()

        try:
            response = await page.goto(
                url,
                wait_until="domcontentloaded",
                timeout=30000,
            )

            # Give JavaScript applications time
            # to finish rendering.
            try:
                await page.wait_for_load_state(
                    "networkidle",
                    timeout=10000,
                )
            except Exception:
                pass

            await page.wait_for_timeout(2000)

            session_id = str(uuid4())

            session = BrowserSession(
                session_id=session_id,
                goal=goal,
                playwright=playwright,
                browser=browser,
                context=context,
                page=page,
            )

            self.sessions[session_id] = session

            observation = await self.observe_session(
                session_id
            )

            return {
                "session_id": session_id,
                "goal": goal,
                "status_code": (
                    response.status
                    if response
                    else None
                ),
                "observation": observation,
            }

        except Exception:
            await context.close()
            await browser.close()
            await playwright.stop()

            raise


    def get_session(
        self,
        session_id: str,
    ) -> BrowserSession:

        session = self.sessions.get(
            session_id
        )

        if session is None:
            raise KeyError(
                f"Session '{session_id}' was not found."
            )

        return session


    async def observe_session(
        self,
        session_id: str,
    ) -> dict:

        session = self.get_session(
            session_id
        )

        page = session.page

        session.step += 1

        ui_elements = await observe_page(
            page
        )

        visible_text = await page.locator(
            "body"
        ).inner_text()

        screenshot_path = (
            SCREENSHOT_DIRECTORY
            / f"{session_id}_step_{session.step}.png"
        )

        await page.screenshot(
            path=str(screenshot_path),
            full_page=True,
        )

        return {
            "step": session.step,
            "title": await page.title(),
            "url": page.url,
            "visible_text": visible_text[:5000],
            "screenshot": str(
                screenshot_path
            ),
            "ui": ui_elements,
        }


    async def perform_action(
        self,
        session_id: str,
        action: str,
        target: str | None = None,
        value: str | None = None,
    ) -> dict:

        session = self.get_session(
            session_id
        )

        page = session.page

        result = await execute_action(
            page=page,
            action=action,
            target=target,
            value=value,
        )

        # Give the page time to react to
        # the action.
        await page.wait_for_timeout(500)

        try:
            await page.wait_for_load_state(
                "networkidle",
                timeout=3000,
            )
        except Exception:
            pass

        observation = await self.observe_session(
            session_id
        )

        return {
            "action": result,
            "observation": observation,
        }


    async def close_session(
        self,
        session_id: str,
    ) -> dict:

        session = self.get_session(
            session_id
        )

        # Gracefully close the browsing context
        # before closing the browser.
        await session.context.close()

        await session.browser.close()

        await session.playwright.stop()

        del self.sessions[session_id]

        return {
            "session_id": session_id,
            "status": "closed",
        }


session_manager = SessionManager()