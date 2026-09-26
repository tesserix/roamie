import json
from importlib.metadata import version
from pathlib import Path

from tesserix_mcp_manifest import ServerAuthoringManifest, ToolSummary, compile_manifests
from tesserix_mcp_runtime import ToolCatalog

from roamie_travel_mcp.server import TravelTool, UnavailableProvider

catalog = ToolCatalog([TravelTool(UnavailableProvider())])
document = json.loads(Path("mcp-authoring.json").read_text())
document["tools"] = [
    ToolSummary.from_runtime(tool).model_dump(mode="json") for tool in catalog.manifests
]
manifest = ServerAuthoringManifest.model_validate_json(json.dumps(document))
compiled = compile_manifests(manifest, runtime_version=version("tesserix-mcp-runtime"))
Path("server.json").write_bytes(compiled.server_json)
registry = json.loads(compiled.registry_manifest)
registry["metadata"]["name"] = "roamie-travel-mcp"
registry["metadata"]["tag"] = "1.0.1"
registry["spec"]["name"] = "roamie-travel-mcp"
registry["spec"]["credentialRef"] = {
    "secretName": "product-mcp-upstream-keys",
    "key": "ROAMIE_TRAVEL_MCP_KEY",
    "header": "X-MCP-Key",
}
registry["spec"]["serviceSelector"] = {
    "namespaces": {"matchLabels": {"kubernetes.io/metadata.name": "roamie"}},
    "services": {"matchLabels": {"app.kubernetes.io/name": "roamie-travel-mcp"}},
}
registry["spec"]["tools"] = ["roamie-travel-search"]
registry["spec"]["toolSelector"] = {"matchLabels": {"mcp.tesserix.app/server": "roamie-travel-mcp"}}
tool = {
    "apiVersion": registry["apiVersion"],
    "kind": "Tool",
    "metadata": {
        **registry["metadata"],
        "name": "roamie-travel-search",
        "labels": {
            **registry["metadata"].get("labels", {}),
            "mcp.tesserix.app/server": "roamie-travel-mcp",
        },
        "annotations": {
            **registry["metadata"].get("annotations", {}),
            "mcp.devai.io/wire-name": "travel_search",
        },
    },
    "spec": {
        "name": "travel_search",
        "description": TravelTool.metadata.description,
        "inputSchema": TravelTool.input_schema,
        "outputSchema": TravelTool.output_schema,
    },
}
Path("tool.json").write_text(json.dumps(tool, indent=2, sort_keys=True) + "\n")
Path("mcpserver.json").write_text(json.dumps(registry, indent=2, sort_keys=True) + "\n")
