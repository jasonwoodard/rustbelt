import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from platformdirs import user_cache_dir


DEFAULT_APP_NAME = "rustbelt-census"


def get_cache_dir(override: Optional[str] = None) -> Path:
    if override:
        path = Path(override).expanduser()
    else:
        path = Path(user_cache_dir(DEFAULT_APP_NAME))
    path.mkdir(parents=True, exist_ok=True)
    return path


def read_cache_json(path: Path, ttl_days: Optional[int] = None) -> Optional[dict[str, Any]]:
    if not path.exists():
        return None
    if ttl_days is not None:
        modified = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
        if datetime.now(timezone.utc) - modified > timedelta(days=ttl_days):
            return None
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return None


def write_cache_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True))
