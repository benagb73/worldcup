"""
scripts/check_squads.py

Validate every team in the DB has a clean 26-player squad with unique shirt
numbers 1-26 — no gaps, no duplicates, no out-of-range numbers, no missing
shirts.

  python -m scripts.check_squads

Exits with code 0 if every team is clean, 1 if any issue is found, so it
can be wired into CI later if desired.

Reports per team:
  - total player count (expected: 26)
  - missing shirt numbers (gaps in 1..26)
  - duplicate shirt numbers (and which players share them)
  - shirts outside 1..26 (and which player has them)
  - players with NULL shirt_number

Does NOT modify the DB — pure read-only diagnostics.
"""

from __future__ import annotations

import asyncio
import os
import sys

# UTF-8 console for accented names on Windows
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.db.connection import get_db


EXPECTED_COUNT = 26
EXPECTED_SHIRTS = set(range(1, 27))   # 1..26 inclusive


async def main() -> int:
    issues_found = 0

    async with get_db() as db:
        teams = await db.fetchall(
            "SELECT id, name, code FROM teams ORDER BY name"
        )

        for t in teams:
            players = await db.fetchall(
                "SELECT id, name, shirt_number, position FROM players "
                "WHERE team_id = ? ORDER BY shirt_number, name",
                [t["id"]]
            )

            team_issues = _check_team(players)
            if not team_issues:
                continue

            issues_found += 1
            print(f"\n{t['code']}  {t['name']}  ({len(players)} players)")
            for line in team_issues:
                print(f"  {line}")

    if issues_found == 0:
        print("All teams have a clean 26-player squad with unique shirt numbers 1-26.")
        return 0

    print(f"\n{issues_found} team(s) need attention.")
    return 1


def _check_team(players: list[dict]) -> list[str]:
    """Return a list of human-readable issue strings for this team's squad."""
    issues: list[str] = []

    # ---- Headcount
    if len(players) != EXPECTED_COUNT:
        issues.append(
            f"PLAYER COUNT: {len(players)} (expected {EXPECTED_COUNT})"
        )

    # ---- Bucket players by shirt number
    by_shirt: dict[int | None, list[dict]] = {}
    for p in players:
        by_shirt.setdefault(p["shirt_number"], []).append(p)

    # ---- NULL shirt
    if None in by_shirt:
        names = ", ".join(p["name"] for p in by_shirt[None])
        issues.append(f"NULL shirt_number: {names}")

    # ---- Duplicates
    for n, dup in sorted(by_shirt.items(), key=lambda kv: (kv[0] is None, kv[0])):
        if n is None:
            continue
        if len(dup) > 1:
            names = "; ".join(
                f"{p['name']} ({p['position'] or '?'}, id={p['id']})" for p in dup
            )
            issues.append(f"DUPLICATE shirt #{n}: {names}")

    # ---- Out of range
    out = sorted(n for n in by_shirt if n is not None and n not in EXPECTED_SHIRTS)
    for n in out:
        names = ", ".join(p["name"] for p in by_shirt[n])
        issues.append(f"OUT OF RANGE shirt #{n}: {names}")

    # ---- Gaps within 1..26 (only the shirts the team actually has)
    present = {n for n in by_shirt if n in EXPECTED_SHIRTS}
    gaps = sorted(EXPECTED_SHIRTS - present)
    if gaps:
        issues.append(f"MISSING shirts: {', '.join('#' + str(g) for g in gaps)}")

    return issues


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
