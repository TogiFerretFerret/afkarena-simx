#!/usr/bin/env python3
"""Produce a reproducible source inventory, not a reachability analysis.

Usage: python3 tools/inventory.py > work/source-inventory.json
Lexical indicators are leads for AST analysis, not proof of executable behavior.
"""
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
PATTERNS = {
    "class_extend": r"\b(?:cc\.Class|[\w.]+)\.extend\s*\(",
    "override": r"\bed\.override\s*\(",
    "client_callback": r"\bclientCall\s*\(",
    "math_random": r"\bMath\.random\s*\(",
    "dynamic_eval": r"\beval\s*\(|\bnew\s+Function\s*\(",
    "companion": r"companions?",
    "local_bot": r"localBot",
}


def inventory():
    files = []
    for path in sorted((ROOT / "src").rglob("*")):
        if not path.is_file():
            continue
        raw = path.read_bytes()
        item = {
            "path": path.relative_to(ROOT).as_posix(),
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
        }
        if path.suffix == ".js":
            source = raw.decode("utf-8", errors="replace")
            item["lexical_indicators"] = {
                name: len(re.findall(pattern, source, re.IGNORECASE))
                for name, pattern in PATTERNS.items()
            }
        files.append(item)
    return {"version": 1, "analysis": "lexical_inventory_only", "files": files}


if __name__ == "__main__":
    print(json.dumps(inventory(), indent=2))
