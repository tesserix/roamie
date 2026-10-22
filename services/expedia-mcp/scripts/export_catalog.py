import asyncio
import hashlib
import json
from pathlib import Path

import httpx
from pydantic import SecretStr

from expedia_recommendations_mcp.client import ExpediaClient
from expedia_recommendations_mcp.server import catalog


async def main() -> str:
    async with httpx.AsyncClient() as http:
        tools = catalog(ExpediaClient(http, key=SecretStr(""))).manifests
    definitions = [
        {
            "name": tool.metadata.name,
            "effect": tool.metadata.effect.value,
            "requiredScopes": tool.metadata.required_scopes,
            "inputSchema": tool.input_schema,
            "outputSchema": tool.output_schema,
        }
        for tool in tools
    ]
    digest = hashlib.sha256(
        json.dumps(definitions, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    result = {
        "protocolVersion": "2026-07-28",
        "gatewayExport": False,
        "tenant": "roamie",
        "schemaDigest": digest,
        "tools": definitions,
    }
    return json.dumps(result, indent=2, sort_keys=True) + "\n"


Path("catalog.json").write_text(asyncio.run(main()))
