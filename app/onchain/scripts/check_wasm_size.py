#!/usr/bin/env python3
"""Gate WASM binary size regressions against committed budget.

Reads `wasm_size_budget.json` (committed budget + tolerance) and measures
the compiled WASM binary size, then fails the build when the size exceeds
the budget beyond the allowed tolerance.

The failure output shows the current size, budget, and delta so a regression
is actionable.

Usage:
    python3 check_wasm_size.py \
        [--budget path/to/wasm_size_budget.json] \
        [--wasm path/to/target/wasm32v1-none/release/aid_escrow.wasm]
"""

import argparse
import json
import os
import sys
from pathlib import Path


def default_budget_path() -> Path:
    here = Path(__file__).resolve().parent
    return here.parent / "contracts" / "aid_escrow" / "wasm_size_budget.json"


def default_wasm_path() -> Path:
    here = Path(__file__).resolve().parent
    return here.parent / "target" / "wasm32v1-none" / "release" / "aid_escrow.wasm"


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def fmt(n: int) -> str:
    return f"{n:,}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--budget", type=Path, default=default_budget_path())
    parser.add_argument("--wasm", type=Path, default=default_wasm_path())
    args = parser.parse_args()

    budget_path: Path = args.budget
    wasm_path: Path = args.wasm

    if not budget_path.exists():
        print(f"ERROR: budget file not found: {budget_path}", file=sys.stderr)
        return 2
    if not wasm_path.exists():
        print(f"ERROR: WASM file not found: {wasm_path}", file=sys.stderr)
        print("       Did you build the contract with cargo build --release --target wasm32v1-none?", file=sys.stderr)
        return 2

    budget_doc = load_json(budget_path)
    tolerance_pct = float(budget_doc.get("tolerance_pct", 0))
    max_size = int(budget_doc.get("max_size_bytes", 0))
    soroban_limit = int(budget_doc.get("soroban_limit_bytes", 131072))

    measured_size = wasm_path.stat().st_size
    allowed_size = max_size * (1 + tolerance_pct / 100.0)
    delta = measured_size - max_size
    delta_pct = (delta / max_size * 100) if max_size else 0

    over_budget = measured_size > allowed_size
    near_limit = measured_size > soroban_limit

    print("=" * 78)
    print("WASM binary size budget gate")
    print(f"  budget  : {budget_path}")
    print(f"  wasm    : {wasm_path}")
    print(f"  tolerance: +{tolerance_pct:g}%")
    print("=" * 78)
    print(f"\nMeasured size : {fmt(measured_size)} bytes ({measured_size / 1024:.2f} KB)")
    print(f"Budget size   : {fmt(max_size)} bytes ({max_size / 1024:.2f} KB)")
    print(f"Allowed size  : {fmt(int(allowed_size))} bytes ({allowed_size / 1024:.2f} KB)")
    print(f"Delta         : {fmt(delta)} bytes ({delta_pct:+.1f}%)")
    print(f"Soroban limit : {fmt(soroban_limit)} bytes ({soroban_limit / 1024:.2f} KB)")

    # Support deliberate budget updates via environment variable
    if os.getenv("SOTER_UPDATE_WASM_SIZE_BUDGET"):
        budget_doc["max_size_bytes"] = measured_size
        with budget_path.open("w", encoding="utf-8") as fh:
            json.dump(budget_doc, fh, indent=2)
            fh.write("\n")
        print(f"\nUpdated budget file with measured size: {fmt(measured_size)} bytes")
        print(f"Commit {budget_path} in a reviewed PR to apply the new budget.")
        return 0

    if over_budget:
        print("\n" + "=" * 78)
        print(f"FAILED: WASM size exceeds budget by {fmt(measured_size - int(allowed_size))} bytes")
        print("=" * 78)
        return 1

    if near_limit:
        print("\n" + "=" * 78)
        print(f"WARNING: WASM size is approaching Soroban deployment limit")
        print(f"         Current: {fmt(measured_size)} bytes, Limit: {fmt(soroban_limit)} bytes")
        print("=" * 78)

    print("\n" + "=" * 78)
    print("PASSED: WASM size is within committed budget.")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())
