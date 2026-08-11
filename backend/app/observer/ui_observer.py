from playwright.async_api import Page


async def observe_page(page: Page) -> dict:
    """
    Inspect the current webpage and return structured
    information about visible UI elements.
    """

    headings = await extract_headings(page)
    buttons = await extract_buttons(page)
    links = await extract_links(page)
    inputs = await extract_inputs(page)

    return {
        "headings": headings,
        "buttons": buttons,
        "links": links,
        "inputs": inputs,
    }


async def extract_headings(page: Page) -> list[dict]:
    headings = []

    locator = page.locator("h1, h2, h3, h4, h5, h6")
    count = await locator.count()

    for index in range(count):
        element = locator.nth(index)

        if not await element.is_visible():
            continue

        text = (await element.inner_text()).strip()

        if not text:
            continue

        tag_name = await element.evaluate(
            "(element) => element.tagName.toLowerCase()"
        )

        element_id = f"heading_{index}"

        await element.evaluate(
            "(element, id) => element.setAttribute('data-ai-id', id)",
            element_id,
        )

        headings.append({
            "id": element_id,
            "text": text,
            "level": int(tag_name[1]),
        })

    return headings


async def extract_buttons(page: Page) -> list[dict]:
    buttons = []

    locator = page.get_by_role("button")
    count = await locator.count()

    for index in range(count):
        element = locator.nth(index)

        if not await element.is_visible():
            continue

        text = (await element.inner_text()).strip()
        aria_label = await element.get_attribute("aria-label")

        element_id = f"button_{index}"

        await element.evaluate(
            "(element, id) => element.setAttribute('data-ai-id', id)",
            element_id,
        )

        buttons.append({
            "id": element_id,
            "text": text,
            "aria_label": aria_label,
            "disabled": await element.is_disabled(),
        })

    return buttons


async def extract_links(page: Page) -> list[dict]:
    links = []

    locator = page.get_by_role("link")
    count = await locator.count()

    for index in range(count):
        element = locator.nth(index)

        if not await element.is_visible():
            continue

        text = (await element.inner_text()).strip()
        href = await element.get_attribute("href")

        element_id = f"link_{index}"

        await element.evaluate(
            "(element, id) => element.setAttribute('data-ai-id', id)",
            element_id,
        )

        links.append({
            "id": element_id,
            "text": text,
            "href": href,
        })

    return links


async def extract_inputs(page: Page) -> list[dict]:
    inputs = []

    locator = page.locator(
        "input, textarea, select"
    )

    count = await locator.count()

    for index in range(count):
        element = locator.nth(index)

        if not await element.is_visible():
            continue

        tag_name = await element.evaluate(
            "(element) => element.tagName.toLowerCase()"
        )

        input_type = await element.get_attribute("type")
        name = await element.get_attribute("name")
        placeholder = await element.get_attribute("placeholder")
        aria_label = await element.get_attribute("aria-label")
        value = await element.input_value()

        element_id = f"input_{index}"

        await element.evaluate(
            "(element, id) => element.setAttribute('data-ai-id', id)",
            element_id,
        )
        

        inputs.append({
    "id": element_id,
    "tag": tag_name,
    "type": input_type,
    "name": name,
    "placeholder": placeholder,
    "aria_label": aria_label,
    "value": value,
    "disabled": await element.is_disabled(),
        
                    })

    return inputs