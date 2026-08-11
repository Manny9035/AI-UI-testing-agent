from fastapi import FastAPI, HTTPException
from pydantic import (
    BaseModel,
    Field,
    HttpUrl,
)
from app.planner.ai_planner import (
    plan_next_action,
)

from app.agent.agent_runner import (
    run_agent,
    run_agent_step,
)
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

class AgentRunRequest(BaseModel):
    max_steps: int = Field(
        default=8,
        ge=1,
        le=20,
    )
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


@app.post(
    "/api/session/{session_id}/plan"
)
async def plan_session_action(
    session_id: str,
):
    try:
        session = session_manager.get_session(
            session_id
        )

        observation = (
            await session_manager.observe_session(
                session_id
            )
        )
        plan = await plan_next_action(
                goal=session.goal,
                observation=observation,
                memory=session.agent_memory,
            )

        return {
            "session_id": session_id,
            "goal": session.goal,
            "observation": observation,
            "plan": plan,
        }

    except KeyError as error:
        raise HTTPException(
            status_code=404,
            detail=str(error),
        )

    except Exception as error:
        raise HTTPException(
            status_code=500,
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

@app.post(
    "/api/session/{session_id}/step"
)
async def agent_step(
    session_id: str,
):
    try:
        return await run_agent_step(
            session_id
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

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error),
        )

@app.post(
    "/api/session/{session_id}/run"
)
async def run_session_agent(
    session_id: str,
    request: AgentRunRequest,
):
    try:
        return await run_agent(
            session_id=session_id,
            max_steps=request.max_steps,
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

    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=str(error),
        )   

@app.get(
    "/api/session/{session_id}/memory"
)
async def get_session_memory(
    session_id: str,
):
    try:
        memory = session_manager.get_memory(
            session_id
        )

        return {
            "session_id": session_id,
            "memory_size": len(memory),
            "memory": memory,
        }

    except KeyError as error:
        raise HTTPException(
            status_code=404,
            detail=str(error),
        )    