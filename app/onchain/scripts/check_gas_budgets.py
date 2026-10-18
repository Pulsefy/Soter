#!/usr/bin/env python3
"""Gate gas / resource regressions against committed budgets.

Reads `gas_budgets.json` (committed budgets + tolerance) and the per-operation
metrics artifacts produced by the gas profiling tests, then fails the build
when any measured cost exceeds its budget beyond the allowed tolerance.

The failure output names the entry point and the delta vs budget so a
regression is actionable.

Usage:
    python3 check_gas_budgets.py \
        [--budgets path/to/gas_budgets.json] \
        [--metrics-dir path/to/target/gas_metrics]
"""

import argparse
import json
import sys
from pathlib import Path


def default_budgets_path() -> Path:
    here = Path(__file__).resolve().parent
    return here.parent / "contracts" / "aid_escrow" / "gas_budgets.json"


def default_metrics_dir() -> Path:
    here = Path(__file__).resolve().parent
    return here.parent / "target" / "gas_metrics"


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def fmt(n: int) -> str:
    return f"{n:,}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--budgets", type=Path, default=default_budgets_path())
    parser.add_argument("--metrics-dir", type=Path, default=default_metrics_dir())
    args = parser.parse_args()

    budgets_path: Path = args.budgets
    metrics_dir: Path = args.metrics_dir

    if not budgets_path.exists():
        print(f"ERROR: budgets file not found: {budgets_path}", file=sys.stderr)
        return 2
    if not metrics_dir.exists():
        print(f"ERROR: metrics dir not found: {metrics_dir}", file=sys.stderr)
        print("       Did the gas profiling tests run?", file=sys.stderr)
        return 2

    budgets_doc = load_json(budgets_path)
    tolerance = budgets_doc.get("tolerance", {})
    cpu_pct = float(tolerance.get("cpu_instructions_pct", 0))
    mem_pct = float(tolerance.get("memory_bytes_pct", 0))
    budgets = budgets_doc.get("budgets", {})

    metric_files = sorted(metrics_dir.glob("*.json"))
    if not metric_files:
        print(f"ERROR: no gas metric artifacts found in {metrics_dir}", file=sys.stderr)
        return 2

    regressions = []

    print("=" * 78)
    print("Gas / resource budget gate")
    print(f"  budgets : {budgets_path}")
    print(f"  metrics : {metrics_dir}")
    print(f"  tolerance: cpu +{cpu_pct:g}%  memory +{mem_pct:g}%")
    print("=" * 78)

    for mf in metric_files:
        metric = load_json(mf)
        operation = metric["operation"]
        size = int(metric.get("size", 1))
        measured_cpu = int(metric["cpu_instructions"])
        measured_mem = int(metric["memory_bytes"])

        if operation not in budgets:
            print(f"\n[CONFIG ERROR] {operation}: no committed budget")
            print("    Add an entry under `budgets` in gas_budgets.json.")
            regressions.append((operation, "missing budget", 0, 0, 0, 0))
            continue

        budget = budgets[operation]
        base_cpu = int(budget["cpu_instructions"])
        base_mem = int(budget["memory_bytes"])

        norm_cpu = measured_cpu
        norm_mem = measured_mem
        scope = operation if size <= 1 else f"{operation} (batch size {size})"

        allowed_cpu = base_cpu * (1 + cpu_pct / 100.0)
        allowed_mem = base_mem * (1 + mem_pct / 100.0)

        cpu_over = norm_cpu > allowed_cpu
        mem_over = norm_mem > allowed_mem

        delta_cpu = norm_cpu - base_cpu
        delta_mem = norm_mem - base_mem

        status = "OK"
        if cpu_over or mem_over:
            status = "REGRESSION"
            regressions.append(
                (operation, scope, norm_cpu, base_cpu, norm_mem, base_mem)
            )

        print(f"\n[{status}] {scope}")
        if base_cpu:
            print(
                f"    CPU     : measured {fmt(norm_cpu)}  budget {fmt(base_cpu)}  "
                f"allowed {fmt(int(allowed_cpu))}  delta {fmt(delta_cpu)} "
                f"({delta_cpu / base_cpu * 100:+.1f}%)"
            )
        else:
            print(f"    CPU     : measured {fmt(norm_cpu)}  budget {fmt(base_cpu)}")
        if base_mem:
            print(
                f"    Memory  : measured {fmt(norm_mem)}  budget {fmt(base_mem)}  "
                f"allowed {fmt(int(allowed_mem))}  delta {fmt(delta_mem)} "
                f"({delta_mem / base_mem * 100:+.1f}%)"
            )
        else:
            print(f"    Memory  : measured {fmt(norm_mem)}  budget {fmt(base_mem)}")

    print("\n" + "=" * 78)
    if regressions:
        print(f"FAILED: {len(regressions)} gas/resource regression(s) detected:")
        for op, scope, norm_cpu, base_cpu, norm_mem, base_mem in regressions:
            if scope == "missing budget":
                print(f"  - {op}: missing committed budget")
                continue
            delta_cpu = norm_cpu - base_cpu
            delta_mem = norm_mem - base_mem
            print(
                f"  - {op}: CPU delta {fmt(delta_cpu)} "
                f"({delta_cpu / base_cpu * 100 if base_cpu else 0:+.1f}%), "
                f"Memory delta {fmt(delta_mem)} "
                f"({delta_mem / base_mem * 100 if base_mem else 0:+.1f}%)"
            )
        print("=" * 78)
        return 1

    print("PASSED: all measured entry points are within committed budgets.")
    print("=" * 78)
    return 0


if __name__ == "__main__":
    sys.exit(main())
