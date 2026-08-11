import json
import os
from typing import Literal

from dotenv import load_dotenv
from google import genai
from pydantic import BaseModel


load_dotenv()


MODEL = os.getenv(
    "GEMINI_MODEL",
    "gemini-3.5-flash-lite",
)


client = genai.Client(
    api_key=os.getenv("GEMINI_API_KEY")
)


class BrowserAction(BaseModel):
    action: Literal[
        "click",
        "fill",
        "press",
        "scroll",
        "finish",
    ]

    target: str | None
    value: str | None
    reason: str


async def plan_next_action(
    goal: str,
    observation: dict,
    memory: list[dict] | None = None,
) -> dict:
    """
    Ask Gemini to choose ONE useful next browser
    action based on the testing goal and current UI.

    This function only plans the action.
    It does not execute it.
    """

    observation_json = json.dumps(
        observation,
        indent=2,
    )

    memory = memory or []

    memory_json = json.dumps(
        memory[-10:],
        indent=2,
    )

    prompt = f"""
You are the planning component of an autonomous
web UI testing agent.

Your job is to choose exactly ONE next browser action
that helps test the stated goal.

AVAILABLE ACTIONS:

- click
- fill
- press
- scroll
- finish


RULES:

1. Never invent element IDs.

2. For click and fill actions, the target must be
   an existing element ID from the current observation.

3. For fill actions, only use obviously fake testing data.

4. Never request or use real passwords,
   payment information, personal information,
   API keys, or secrets.

5. Prefer actions that reveal useful application behaviour.

6. Do not perform destructive or irreversible actions.

7. Choose exactly ONE action.

8. Carefully review the testing history before deciding.

9. Avoid repeating tests that have already been performed
   unless the page state changed and repeating the action
   is necessary to verify the new state.

10. Prefer actions that increase testing coverage.

11. If the testing goal appears sufficiently tested or
    there is no useful safe action remaining,
    choose "finish".

12. Briefly explain why the chosen action is useful.


TESTING GOAL:

{goal}


PREVIOUS TESTING HISTORY:

{memory_json}


CURRENT PAGE OBSERVATION:

{observation_json}


Choose the best NEXT testing action.
"""

    response = await client.aio.models.generate_content(
        model=MODEL,
        contents=prompt,
        config={
            "response_mime_type": "application/json",
            "response_json_schema": BrowserAction.model_json_schema(),
        },
    )

    action = BrowserAction.model_validate_json(
        response.text
    )

    return action.model_dump()
