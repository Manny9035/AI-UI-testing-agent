from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, HttpUrl

from app.browser.playwright_manager import (
    inspect_website,
    test_manual_interaction,
)

from app.session.session_manager import (
    session_manager,
)


app = FastAPI(
    title="AI UI Testing Agent",
    description="Backend API for autonomous website testing.",
    version="0.2.0",
)


# ============================================================
# REQUEST MODELS
# ============================================================


class TestRequest(BaseModel):
    url: HttpUrl
    goal: str


class ActionRequest(BaseModel):
    action: str
    target: str | None = None
    value: str | None = None


# ============================================================
# BASIC HEALTH CHECK
# ============================================================


@app.get("/")
async def root():
    return {
        "name": "AI UI Testing Agent",
        "status": "running",
    }


# ============================================================
# ORIGINAL OBSERVATION TEST
# ============================================================


@app.post("/api/test")
async def run_test(
    request: TestRequest,
):
    result = await inspect_website(
        str(request.url)
    )

    return {
        "goal": request.goal,
        "observation": result,
    }


# ============================================================
# TEMPORARY MANUAL INTERACTION TEST
# ============================================================


@app.post("/api/test-interaction")
async def run_interaction_test(
    request: TestRequest,
):
    result = await test_manual_interaction(
        str(request.url)
    )

    return {
        "goal": request.goal,
        "result": result,
    }


# ============================================================
# START A TEST SESSION
# ============================================================


@app.post("/api/session/start")
async def start_session(
    request: TestRequest,
):
    try:
        return await session_manager.create_session(
            url=str(request.url),
            goal=request.goal,
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error),
        )


# ============================================================
# OBSERVE AN EXISTING SESSION
# ============================================================


@app.get(
    "/api/session/{session_id}/observe"
)
async def observe_session(
    session_id: str,
):
    try:
        return await session_manager.observe_session(
            session_id
        )

    except KeyError as error:
        raise HTTPException(
            status_code=404,
            detail=str(error),
        )


# ============================================================
# PERFORM ACTION
# ============================================================


@app.post(
    "/api/session/{session_id}/action"
)
async def perform_action(
    session_id: str,
    request: ActionRequest,
):
    try:
        return await session_manager.perform_action(
            session_id=session_id,
            action=request.action,
            target=request.target,
            value=request.value,
        )

    except KeyError as error:
        raise HTTPException(
            status_code=404,
            detail=str(error),
        )

    except ValueError as error:
        raise HTTPException(
            status_code=400,
            detail=str(error),
        )


# ============================================================
# END TEST SESSION
# ============================================================


@app.delete(
    "/api/session/{session_id}"
)
async def close_session(
    session_id: str,
):
    try:
        return await session_manager.close_session(
            session_id
        )

    except KeyError as error:
        raise HTTPException(
            status_code=404,
            detail=str(error),
        )