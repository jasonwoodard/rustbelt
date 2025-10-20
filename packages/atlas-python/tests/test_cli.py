from __future__ import annotations

from atlas.cli.__main__ import build_parser


def test_parser_has_version_flag() -> None:
    parser = build_parser()
    args = parser.parse_args(["--version"])
    assert args.version is True
