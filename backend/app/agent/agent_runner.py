from app.planner.ai_planner import plan_next_action
from app.session.session_manager import session_manager


ALLOWED_ACTIONS = {
    "click",
    "fill",
    "press",
    "scroll",
    "finish",
}


def get_element_ids(
    observation: dict,
) -> dict[str, set[str]]:
    """
    Extract element IDs from the current UI observation.

    We separate element types so that, for example,
    the AI cannot try to fill a button.
    """

    ui = observation.get("ui", {})

    buttons = {
        element["id"]
        for element in ui.get("buttons", [])
        if element.get("id")
    }

    inputs = {
        element["id"]
        for element in ui.get("inputs", [])
        if element.get("id")
    }

    links = {
        element["id"]
        for element in ui.get("links", [])
        if element.get("id")
    }

    return {
        "buttons": buttons,
        "inputs": inputs,
        "links": links,
    }


def validate_plan(
    plan: dict,
    observation: dict,
) -> None:
    """
    Validate the AI's proposed action before allowing
    Playwright to execute it.
    """

    action = plan.get("action")
    target = plan.get("target")
    value = plan.get("value")

    if action not in ALLOWED_ACTIONS:
        raise ValueError(
            f"AI proposed unsupported action: {action}"
        )

    element_ids = get_element_ids(
        observation
    )

    clickable_ids = (
        element_ids["buttons"]
        | element_ids["links"]
    )

    # ---------------------------------------------
    # CLICK
    # ---------------------------------------------

    if action == "click":

        if not target:
            raise ValueError(
                "AI proposed click without a target."
            )

        if target not in clickable_ids:
            raise ValueError(
                f"AI proposed invalid click target: {target}"
            )

    # ---------------------------------------------
    # FILL
    # ---------------------------------------------

    elif action == "fill":

        if not target:
            raise ValueError(
                "AI proposed fill without a target."
            )

        if target not in element_ids["inputs"]:
            raise ValueError(
                f"AI proposed invalid fill target: {target}"
            )

        if value is None:
            raise ValueError(
                "AI proposed fill without a value."
            )

    # ---------------------------------------------
    # PRESS
    # ---------------------------------------------

    elif action == "press":

        if not value:
            raise ValueError(
                "AI proposed press without a key."
            )

        if target is not None:
            all_interactive_ids = (
                element_ids["buttons"]
                | element_ids["inputs"]
                | element_ids["links"]
            )

            if target not in all_interactive_ids:
                raise ValueError(
                    f"AI proposed invalid press target: {target}"
                )

    # ---------------------------------------------
    # SCROLL
    # ---------------------------------------------

    elif action == "scroll":

        if value not in {
            "up",
            "down",
            None,
        }:
            raise ValueError(
                "AI scroll value must be 'up' or 'down'."
            )

    # ---------------------------------------------
    # FINISH
    # ---------------------------------------------

    elif action == "finish":

        # Finish should not target an element.
        return

def compact_text(
    text: str | None,
    limit: int = 600,
) -> str:
    """
    Keep memory concise so we do not send huge page
    contents back to the AI every step.
    """

    if not text:
        return ""

    text = " ".join(
        text.split()
    )

    return text[:limit]


def summarize_ui(
    observation: dict,
) -> dict:
    """
    Produce a compact summary of the current UI state.
    """

    ui = observation.get(
        "ui",
        {}
    )

    buttons = [
        {
            "id": item.get("id"),
            "text": item.get("text"),
            "disabled": item.get("disabled"),
        }
        for item in ui.get(
            "buttons",
            []
        )
    ]

    inputs = [
        {
            "id": item.get("id"),
            "type": item.get("type"),
            "name": item.get("name"),
            "value": item.get("value"),
        }
        for item in ui.get(
            "inputs",
            []
        )
    ]

    links = [
        {
            "id": item.get("id"),
            "text": item.get("text"),
        }
        for item in ui.get(
            "links",
            []
        )
    ]

    return {
        "buttons": buttons,
        "inputs": inputs,
        "links": links,
    }


def create_memory_entry(
    memory_step: int,
    plan: dict,
    action_result: dict,
    before: dict,
    after: dict,
) -> dict:
    """
    Convert one completed agent action into a concise
    memory record for future planning.
    """

    return {
        "step": memory_step,

        "decision": {
            "action": plan.get("action"),
            "target": plan.get("target"),
            "value": plan.get("value"),
            "reason": plan.get("reason"),
        },

        "execution": {
            "success": action_result.get(
                "success",
                False,
            )
        },

        "before_url": before.get(
            "url"
        ),

        "after_url": after.get(
            "url"
        ),

        "url_changed": (
            before.get("url")
            != after.get("url")
        ),

        "resulting_page_text": compact_text(
            after.get("visible_text")
        ),

        "resulting_ui": summarize_ui(
            after
        ),
    }
async def run_agent_step(
    session_id: str,
) -> dict:
    """
    Perform one complete AI agent step:

    1. Observe
    2. Plan
    3. Validate
    4. Act
    5. Observe again
    """

    # ---------------------------------------------
    # 1. GET ACTIVE SESSION
    # ---------------------------------------------

    session = session_manager.get_session(
        session_id
    )

    # ---------------------------------------------
    # 2. OBSERVE CURRENT PAGE
    # ---------------------------------------------

    before = await session_manager.observe_session(
        session_id
    )

    # ---------------------------------------------
    # 3. ASK GEMINI WHAT TO DO
    # ---------------------------------------------

    plan = await plan_next_action(
        goal=session.goal,
        observation=before,
        memory=session.agent_memory,
    )

    # ---------------------------------------------
    # 4. VALIDATE GEMINI'S DECISION
    # ---------------------------------------------

    validate_plan(
        plan=plan,
        observation=before,
    )

    # ---------------------------------------------
    # 5. HANDLE FINISH
    # ---------------------------------------------

    if plan["action"] == "finish":

        return {
            "session_id": session_id,
            "goal": session.goal,
            "status": "finished",
            "before": before,
            "plan": plan,
            "action": None,
            "after": before,
        }

    # ---------------------------------------------
    # 6. EXECUTE AI ACTION
    # ---------------------------------------------

    result = await session_manager.perform_action(
        session_id=session_id,
        action=plan["action"],
        target=plan["target"],
        value=plan["value"],
    )

    # perform_action() already observes the page
    # after executing the browser action.

    after = result["observation"]

    memory_entry = create_memory_entry(
        memory_step=len(session.agent_memory) + 1,
        plan=plan,
        action_result=result["action"],
        before=before,
        after=after,
    )

    session_manager.add_memory(
        session_id=session_id,
        memory_entry=memory_entry,
    )

    # ---------------------------------------------
    # 7. RETURN COMPLETE STEP
    # ---------------------------------------------

    return {
        "session_id": session_id,
        "goal": session.goal,
        "status": "acted",
        "before": before,
        "plan": plan,
        "action": result["action"],
        "after": after,
        "memory_entry": memory_entry,
        "memory_size": len(session.agent_memory),
    }

async def run_agent(
    session_id: str,
    max_steps: int = 8,
) -> dict:
    """
    Run the AI testing agent autonomously.

    The agent repeatedly:
    1. Observes
    2. Plans
    3. Validates
    4. Acts
    5. Observes again

    It stops when:
    - Gemini chooses "finish"
    - max_steps is reached
    - the same action repeats too many times
    """

    session = session_manager.get_session(
        session_id
    )

    history = []

    previous_plan_signature = None
    repeated_plan_count = 0

    for agent_step_number in range(
        1,
        max_steps + 1,
    ):

        # -----------------------------------------
        # RUN ONE COMPLETE AGENT STEP
        # -----------------------------------------

        result = await run_agent_step(
            session_id
        )

        history.append({
            "agent_step": agent_step_number,
            "status": result["status"],
            "plan": result["plan"],
            "action": result["action"],
            "after": result["after"],
        })

        plan = result["plan"]

        # -----------------------------------------
        # AI DECIDED TESTING IS COMPLETE
        # -----------------------------------------

        if plan["action"] == "finish":

            return {
                "session_id": session_id,
                "goal": session.goal,
                "status": "finished",
                "stop_reason": "AI decided testing was complete.",
                "steps_completed": agent_step_number,
                "history": history,
            }

        # -----------------------------------------
        # DETECT REPEATED ACTIONS
        # -----------------------------------------

        current_plan_signature = (
            plan.get("action"),
            plan.get("target"),
            plan.get("value"),
        )

        if (
            current_plan_signature
            == previous_plan_signature
        ):
            repeated_plan_count += 1
        else:
            repeated_plan_count = 0

        previous_plan_signature = (
            current_plan_signature
        )

        # Stop after the same decision happens
        # three times in succession.
        if repeated_plan_count >= 2:

            return {
                "session_id": session_id,
                "goal": session.goal,
                "status": "stopped",
                "stop_reason": (
                    "The AI repeated the same action "
                    "three times."
                ),
                "steps_completed": agent_step_number,
                "history": history,
            }

    # ---------------------------------------------
    # MAXIMUM STEP LIMIT REACHED
    # ---------------------------------------------

    return {
        "session_id": session_id,
        "goal": session.goal,
        "status": "stopped",
        "stop_reason": (
            f"Maximum step limit of "
            f"{max_steps} reached."
        ),
        "steps_completed": max_steps,
        "history": history,
    }
