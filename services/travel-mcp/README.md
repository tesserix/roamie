# Roamie product MCP

Implements `travel_search` using the existing Roamie nearby API for food, activities and trip evidence. Other categories return unavailable. Workload API authentication must be verified before activation. Memory generation is not implemented. The backend owns signed profile snapshots and current-profile verification.

Uses the pinned published Tesserix MCP Runtime 0.1.0rc6 and native Streamable HTTP.
The runtime HTTP boundary verifies its gateway key and trusted peer. The Zitadel adapter verifies signature, issuer, project audience, token lifetime, exact manager subject and organization role before mapping to the Roamie tenant and travel-read scope.
Each package owns its dependencies, lockfile, Dockerfile and compiled manifests.
Gateway export is disabled until registry and authentication integration is tested.
Secrets belong in environment/ExternalSecret references; none are checked in.

```sh
uv sync --frozen
uv run ruff check .
uv run ruff format --check .
uv run mypy --strict src/
uv run pytest
uv run python scripts/compile_manifest.py
uv build
```

The compiler uses the installed runtime version for serverInfo compatibility.
`mcp-authoring.json` is the source; `server.json` and `mcpserver.json` are generated.
Run tests and regenerate manifests before publication. Container builds were not
verified locally because the Docker daemon was unavailable. No live rollout occurred.

Ownership follows Australis ADR-0004: product connectors live with the product;
shared third-party connectors are independent Australis server packages.
