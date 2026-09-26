from fnmatch import fnmatchcase
from pathlib import Path

import yaml


def test_mcp_catalog_changes_do_not_roll_out_the_api():
    root = Path(__file__).resolve().parents[3]
    workflow = yaml.safe_load((root / ".github/workflows/images.yml").read_text())
    events = workflow.get("on", workflow.get(True))
    patterns = events["push"]["paths"]
    for path in [
        "services/travel-mcp/mcpserver.json",
        "services/travel-mcp/tool.json",
        ".github/workflows/images.yml",
    ]:
        assert not any(fnmatchcase(path, pattern) for pattern in patterns)
    for path in ["services/api/src/main.rs", "Cargo.lock", "docker/api.Dockerfile"]:
        assert any(fnmatchcase(path, pattern) for pattern in patterns)
    assert "workflow_dispatch" in events
