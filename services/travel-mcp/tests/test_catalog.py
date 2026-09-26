import json
import runpy
from pathlib import Path

from roamie_travel_mcp.server import TravelTool

ROOT = Path(__file__).resolve().parents[1]


def test_mcp_catalog_exposes_a_versioned_tool_from_the_real_contract(tmp_path, monkeypatch):
    (tmp_path / "mcp-authoring.json").write_bytes((ROOT / "mcp-authoring.json").read_bytes())
    monkeypatch.chdir(tmp_path)
    runpy.run_path(str(ROOT / "scripts/compile_manifest.py"), run_name="__main__")
    mcp = json.loads((tmp_path / "mcpserver.json").read_text())
    tool = json.loads((tmp_path / "tool.json").read_text())
    assert mcp["metadata"]["visibility"] == tool["metadata"]["visibility"] == "public"
    assert mcp["metadata"]["tag"] == tool["metadata"]["tag"] == "1.0.1"
    assert mcp["metadata"]["labels"]["mcp.tesserix.app/gateway-export"] == "false"
    assert mcp["spec"]["tools"] == [tool["metadata"]["name"]]
    assert mcp["spec"]["toolSelector"]["matchLabels"] == {
        "mcp.tesserix.app/server": "roamie-travel-mcp"
    }
    assert tool["metadata"]["annotations"]["mcp.devai.io/wire-name"] == "travel_search"
    assert tool["metadata"]["labels"]["mcp.tesserix.app/server"] == "roamie-travel-mcp"
    assert tool["spec"]["inputSchema"] == TravelTool.input_schema
    assert tool["spec"]["outputSchema"] == TravelTool.output_schema
