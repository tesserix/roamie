import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from .api import create_app
from .model import load_model


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    app.state.runtime.inference = await asyncio.to_thread(load_model)
    yield
    app.state.runtime.inference = None


app = create_app(lifespan=lifespan)

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    uvicorn.run(
        app,
        host="0.0.0.0",  # noqa: S104 -- internal container listener
        port=8080,
        workers=1,
        access_log=False,
        timeout_keep_alive=5,
        timeout_graceful_shutdown=300,
    )
