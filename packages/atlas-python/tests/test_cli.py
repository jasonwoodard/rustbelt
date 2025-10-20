from __future__ import annotations

import json
from pathlib import Path

from atlas.cli.__main__ import build_parser, main


def test_parser_has_version_flag() -> None:
    parser = build_parser()
    args = parser.parse_args(["--version"])
    assert args.version is True


def test_explain_flag_writes_trace_files(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    main(["--explain"])

    json_path = tmp_path / "atlas-trace.json"
    csv_path = tmp_path / "atlas-trace.csv"

    assert json_path.exists()
    assert csv_path.exists()

    data = json.loads(json_path.read_text())
    assert isinstance(data, list)
    assert data
    row = data[0]
    assert "baseline.value" in row
    assert "scores.value" in row
