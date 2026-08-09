from playwright.async_api import Page


async def execute_action(
    page: Page,
    action: str,
    target: str | None = None,
    value: str | None = None,
) -> dict:
    """
    Execute a browser action against the current page.

    Supported actions:
    - click
    - fill
    - press
    - scroll
    """

    action = action.lower().strip()

    if action == "click":
        return await click_element(
            page=page,
            target=target,
        )

    if action == "fill":
        return await fill_element(
            page=page,
            target=target,
            value=value,
        )

    if action == "press":
        return await press_key(
            page=page,
            target=target,
            value=value,
        )

    if action == "scroll":
        return await scroll_page(
            page=page,
            value=value,
        )

    raise ValueError(
        f"Unsupported action: {action}"
    )


async def click_element(
    page: Page,
    target: str | None,
) -> dict:

    if not target:
        raise ValueError(
            "A target is required for click."
        )

    locator = page.locator(
        f'[data-ai-id="{target}"]'
    )

    if await locator.count() == 0:
        raise ValueError(
            f"Element '{target}' was not found."
        )

    await locator.click()

    return {
        "action": "click",
        "target": target,
        "success": True,
    }


async def fill_element(
    page: Page,
    target: str | None,
    value: str | None,
) -> dict:

    if not target:
        raise ValueError(
            "A target is required for fill."
        )

    if value is None:
        raise ValueError(
            "A value is required for fill."
        )

    locator = page.locator(
        f'[data-ai-id="{target}"]'
    )

    if await locator.count() == 0:
        raise ValueError(
            f"Element '{target}' was not found."
        )

    await locator.fill(value)

    return {
        "action": "fill",
        "target": target,
        "value": value,
        "success": True,
    }


async def press_key(
    page: Page,
    target: str | None,
    value: str | None,
) -> dict:

    if not value:
        raise ValueError(
            "A keyboard key is required."
        )

    if target:
        locator = page.locator(
            f'[data-ai-id="{target}"]'
        )

        if await locator.count() == 0:
            raise ValueError(
                f"Element '{target}' was not found."
            )

        await locator.press(value)

    else:
        await page.keyboard.press(value)

    return {
        "action": "press",
        "target": target,
        "value": value,
        "success": True,
    }


async def scroll_page(
    page: Page,
    value: str | None,
) -> dict:

    direction = (
        value.lower()
        if value
        else "down"
    )

    if direction == "down":
        await page.mouse.wheel(
            0,
            600
        )

    elif direction == "up":
        await page.mouse.wheel(
            0,
            -600
        )

    else:
        raise ValueError(
            "Scroll direction must be 'up' or 'down'."
        )

    return {
        "action": "scroll",
        "value": direction,
        "success": True,
    }