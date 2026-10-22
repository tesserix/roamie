import json
import os
import time

import httpx

KEY = os.environ["EXPEDIA_MCP_GATEWAY_KEY"]
META = {
    "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    "io.modelcontextprotocol/clientCapabilities": {},
}


def payload(response: httpx.Response) -> dict[str, object]:
    response.raise_for_status()
    text = response.text
    if text.startswith("event:"):
        text = next(line[6:] for line in text.splitlines() if line.startswith("data: "))
    body = json.loads(text)
    if not isinstance(body, dict):
        raise ValueError("invalid MCP response")
    return body


def main() -> None:
    with httpx.Client(
        base_url="http://127.0.0.1:8080",
        timeout=3,
        trust_env=False,
        headers={
            "Accept": "application/json, text/event-stream",
            "Content-Type": "application/json",
        },
    ) as client:
        ready = False
        for _ in range(80):
            try:
                ready = client.get("/readyz").status_code == 200
            except httpx.HTTPError:
                pass
            if ready:
                break
            time.sleep(0.1)
        if not ready:
            raise RuntimeError("container never became ready")
        initialized = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2026-07-28",
                "capabilities": {},
                "clientInfo": {"name": "container-qa", "version": "1"},
            },
        }
        denied = client.post("/mcp", json=initialized)
        if denied.status_code not in {401, 403, 404}:
            raise RuntimeError("unauthenticated MCP access was admitted")
        client.headers["X-MCP-Key"] = KEY
        result = payload(client.post("/mcp", json=initialized))
        if "error" in result:
            raise RuntimeError("MCP initialization failed")
        client.headers["MCP-Protocol-Version"] = "2026-07-28"
        tools = payload(
            client.post(
                "/mcp",
                headers={"MCP-Method": "tools/list"},
                json={
                    "jsonrpc": "2.0",
                    "id": 2,
                    "method": "tools/list",
                    "params": {"_meta": META},
                },
            )
        )
        discovered = tools.get("result")
        if not isinstance(discovered, dict) or len(discovered.get("tools", [])) != 4:
            raise RuntimeError("unexpected tool catalog")
        call = payload(
            client.post(
                "/mcp",
                headers={"MCP-Method": "tools/call", "MCP-Name": "get_hotel_recommendations"},
                json={
                    "jsonrpc": "2.0",
                    "id": 3,
                    "method": "tools/call",
                    "params": {
                        "name": "get_hotel_recommendations",
                        "arguments": {"destination": "Melbourne"},
                        "_meta": META,
                    },
                },
            )
        )
        value = call.get("result")
        if not isinstance(value, dict) or value.get("structuredContent") != {
            "status": "unavailable",
            "data_json": None,
        }:
            raise RuntimeError("disabled provider did not fail unavailable")
        print(
            json.dumps(
                {
                    "uid": os.getuid(),
                    "ready": True,
                    "unauthenticatedStatus": denied.status_code,
                    "toolCount": 4,
                    "disabledProvider": "unavailable",
                }
            )
        )


main()
