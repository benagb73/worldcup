"""
scripts/seed_from_api.py

Fetches live 2026 World Cup data from API-Football v3, then wipes
the placeholder seed data and replaces it with real teams, venues,
group assignments, and the full fixture schedule.

Usage:
    python -m scripts.seed_from_api

Requires in .env:
    API_FOOTBALL_KEY   — API-Sports direct key (v3.football.api-sports.io)
                         or RapidAPI key if API_FOOTBALL_HOST contains 'rapidapi'
    API_FOOTBALL_HOST  — defaults to v3.football.api-sports.io
    WC_LEAGUE_ID       — 1 (FIFA World Cup)
    WC_SEASON          — 2026
"""

import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import httpx
from dotenv import load_dotenv

load_dotenv()

from app.db.connection import get_db, init_db

API_KEY   = os.getenv("API_FOOTBALL_KEY", "")
API_HOST  = os.getenv("API_FOOTBALL_HOST", "v3.football.api-sports.io")
SEASON    = int(os.getenv("WC_SEASON", "2026"))
LEAGUE_ID = int(os.getenv("WC_LEAGUE_ID", "1"))

_USE_RAPIDAPI = "rapidapi" in API_HOST.lower()

def _headers() -> dict:
    if _USE_RAPIDAPI:
        return {"X-RapidAPI-Key": API_KEY, "X-RapidAPI-Host": API_HOST}
    return {"x-apisports-key": API_KEY}

# RapidAPI paths use /v3/... prefix; direct API-Sports paths do not
_PATH_PREFIX = "/v3" if _USE_RAPIDAPI else ""
BASE_URL = f"https://{API_HOST}"


# ---------------------------------------------------------------------------
# API helpers
# ---------------------------------------------------------------------------

async def _get(client: httpx.AsyncClient, path: str, params: dict | None = None,
               allow_plan_error: bool = False) -> dict:
    url = f"{BASE_URL}{_PATH_PREFIX}{path}"
    r = await client.get(url, params=params or {}, headers=_headers(), timeout=30)
    r.raise_for_status()
    data = r.json()
    errors = data.get("errors") or {}
    if errors:
        msg = str(errors)
        if allow_plan_error and ("plan" in msg.lower() or "access" in msg.lower()):
            print(f"    GET {path} -> plan restriction: {msg}")
            return {"response": []}
        raise RuntimeError(f"API error on {path}: {errors}")
    remaining = r.headers.get("x-ratelimit-requests-remaining", "?")
    print(f"    GET {path} -> {len(data.get('response', []))} results  (quota remaining: {remaining})")
    return data


# ---------------------------------------------------------------------------
# Stage-name → our schema
# ---------------------------------------------------------------------------

STAGE_MAP = {
    "group stage":    "group",
    "round of 32":    "r32",
    "round of 16":    "r16",
    "quarter-finals": "qf",
    "semi-finals":    "sf",
    "3rd place":      "third_place",
    "final":          "final",
}

STATUS_MAP = {
    "TBD": "scheduled", "NS": "scheduled",
    "1H": "live", "HT": "live", "2H": "live",
    "ET": "live_et", "BT": "live_et",
    "P": "live_penalties", "INT": "live",
    "FT": "final", "AET": "final", "PEN": "final",
    "SUSP": "postponed", "PST": "postponed", "CANC": "postponed",
}

POS_MAP = {
    "Goalkeeper": "GK",
    "Defender":   "DEF",
    "Midfielder": "MID",
    "Attacker":   "FWD",
    "G": "GK", "D": "DEF", "M": "MID", "F": "FWD",
}


def _parse_group(round_str: str) -> str | None:
    """
    API-Football round strings for WC group stage look like:
      'Group A'  /  'Group Stage - 1'  /  'Group A - 1'
    Return the single letter or None if not a group match.
    """
    s = round_str.strip()
    if s.lower().startswith("group stage"):
        return None  # can't determine letter from this format alone
    if s.lower().startswith("group "):
        parts = s.split()
        if len(parts) >= 2 and len(parts[1]) == 1 and parts[1].isalpha():
            return parts[1].upper()
    return None


def _parse_stage(round_str: str) -> str:
    s = round_str.strip().lower()
    for key, val in STAGE_MAP.items():
        if key in s:
            return val
    # Default: if it has 'group' in it, treat as group
    if "group" in s:
        return "group"
    return "group"


# ---------------------------------------------------------------------------
# Main seed logic
# ---------------------------------------------------------------------------

async def seed():
    if not API_KEY:
        print("[ERROR] API_FOOTBALL_KEY is not set in .env")
        sys.exit(1)

    print(f"\n[1/4] Initialising database (host={API_HOST})...")
    await init_db()

    async with httpx.AsyncClient() as client:

        # ---- Fetch standings (gives us team → group mapping) ---------------
        print("\n[2/4] Fetching standings (group membership)...")
        st_data   = await _get(client, "/standings",
                               {"league": LEAGUE_ID, "season": SEASON},
                               allow_plan_error=True)
        st_resp   = st_data.get("response", [])
        # team_id (API) → group letter
        team_group: dict[int, str] = {}
        standings_rows: list = []           # raw rows for DB insert later
        if st_resp:
            league_standings = st_resp[0].get("league", {}).get("standings", [])
            for group_list in league_standings:
                for row in group_list:
                    api_tid = row["team"]["id"]
                    group_raw = row.get("group", "")  # e.g. "Group A"
                    letter = _parse_group(group_raw) or group_raw.split()[-1]
                    team_group[api_tid] = letter
                    standings_rows.append(row)
            print(f"    -> {len(team_group)} teams mapped to groups")
        else:
            print("    -> No standings yet (tournament not started?)")

        # ---- Fetch all fixtures --------------------------------------------
        print("\n[3/4] Fetching fixtures...")
        fx_data   = await _get(client, "/fixtures",
                               {"league": LEAGUE_ID, "season": SEASON},
                               allow_plan_error=True)
        fixtures  = fx_data.get("response", [])
        if not fixtures:
            print("[ERROR] No fixtures returned. Check league ID and season.")
            sys.exit(1)

        # ---- Fetch teams ---------------------------------------------------
        print("\n[4/4] Fetching teams...")
        tm_data   = await _get(client, "/teams",
                               {"league": LEAGUE_ID, "season": SEASON},
                               allow_plan_error=True)
        teams_raw = tm_data.get("response", [])
        # Build lookup: api_team_id → {name, code, logo, ...}
        api_teams: dict[int, dict] = {}
        for row in teams_raw:
            t = row["team"]
            api_teams[t["id"]] = t

        # If standings didn't give us group membership, derive it from fixtures
        if not team_group:
            print("    -> Deriving group membership from fixture round strings...")
            for fx in fixtures:
                round_str = fx["league"].get("round", "")
                letter = _parse_group(round_str)
                if letter:
                    team_group[fx["teams"]["home"]["id"]] = letter
                    team_group[fx["teams"]["away"]["id"]] = letter
            print(f"    -> {len(team_group)} teams mapped to groups from fixtures")

    # =========================================================================
    # Database writes
    # =========================================================================
    print("\n--- Writing to database ---")

    async with get_db() as db:
        # ---- Wipe existing placeholder data (order respects FKs) -----------
        print("[DB] Clearing placeholder data...")
        for table in ["player_match_stats", "match_lineups", "match_events",
                      "bracket", "group_standings", "matches",
                      "players", "teams", "venues", "clubs"]:
            await db.execute(f"DELETE FROM {table}")

        # ---- Venues --------------------------------------------------------
        venue_cache: dict[int, int] = {}   # api_venue_id → our venue.id

        print("[DB] Inserting venues...")
        seen_venues: set[int] = set()
        for fx in fixtures:
            v = fx["fixture"].get("venue") or {}
            vid = v.get("id")
            if not vid or vid in seen_venues:
                continue
            seen_venues.add(vid)
            name    = v.get("name") or "TBD"
            city    = v.get("city") or "TBD"
            country = fx["league"].get("country") or "Unknown"

            rows = await db.execute(
                "INSERT INTO venues (name, city, country) VALUES (?, ?, ?) RETURNING id",
                [name, city, country]
            )
            if rows:
                venue_cache[vid] = rows[0]["id"]

        print(f"    -> {len(venue_cache)} venues inserted")

        # ---- Teams ---------------------------------------------------------
        print("[DB] Inserting teams...")
        # Collect unique teams from fixtures
        api_team_ids: set[int] = set()
        for fx in fixtures:
            api_team_ids.add(fx["teams"]["home"]["id"])
            api_team_ids.add(fx["teams"]["away"]["id"])

        db_team_cache: dict[int, int] = {}   # api_team_id → our teams.id
        for api_tid in sorted(api_team_ids):
            t    = api_teams.get(api_tid, {})
            name = t.get("name") or fx["teams"]["home"]["name"]  # fallback
            code = t.get("code") or name[:3].upper()
            logo = t.get("logo") or None
            grp  = team_group.get(api_tid)   # may be None for knockout-only

            rows = await db.execute(
                """
                INSERT INTO teams (name, code, group_name, flag_url)
                VALUES (?, ?, ?, ?) RETURNING id
                """,
                [name, code, grp, logo]
            )
            if rows:
                db_team_cache[api_tid] = rows[0]["id"]

        print(f"    -> {len(db_team_cache)} teams inserted")

        # ---- Group standings (zeroed rows) ---------------------------------
        print("[DB] Inserting group_standings rows...")
        for api_tid, db_tid in db_team_cache.items():
            grp = team_group.get(api_tid)
            if not grp:
                continue
            # Populate stats from standings if available
            stats = next(
                (r for r in standings_rows if r["team"]["id"] == api_tid), {}
            )
            all_s = stats.get("all", {})
            goals = all_s.get("goals", {})
            await db.execute(
                """
                INSERT OR IGNORE INTO group_standings
                  (group_name, team_id, played, won, drawn, lost, goals_for, goals_against)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    grp, db_tid,
                    all_s.get("played", 0),
                    all_s.get("win", 0),
                    all_s.get("draw", 0),
                    all_s.get("lose", 0),
                    goals.get("for", 0),
                    goals.get("against", 0),
                ]
            )

        # ---- Matches -------------------------------------------------------
        print("[DB] Inserting fixtures...")
        n_group = n_knockout = n_skip = 0

        for fx in fixtures:
            round_str   = fx["league"].get("round", "")
            stage       = _parse_stage(round_str)
            group_ltr   = _parse_group(round_str) if stage == "group" else None

            api_home_id = fx["teams"]["home"]["id"]
            api_away_id = fx["teams"]["away"]["id"]
            home_db_id  = db_team_cache.get(api_home_id)
            away_db_id  = db_team_cache.get(api_away_id)
            if not home_db_id or not away_db_id:
                n_skip += 1
                continue

            api_status  = fx["fixture"]["status"]["short"]
            status      = STATUS_MAP.get(api_status, "scheduled")
            scheduled   = fx["fixture"]["date"]  # ISO8601 already

            api_venue_id = (fx["fixture"].get("venue") or {}).get("id")
            venue_db_id  = venue_cache.get(api_venue_id)

            score  = fx.get("score", {})
            ht_h   = (score.get("halftime") or {}).get("home")
            ht_a   = (score.get("halftime") or {}).get("away")
            ft_h   = (score.get("fulltime") or {}).get("home")
            ft_a   = (score.get("fulltime") or {}).get("away")
            et_h   = (score.get("extratime") or {}).get("home")
            et_a   = (score.get("extratime") or {}).get("away")
            pn_h   = (score.get("penalty") or {}).get("home")
            pn_a   = (score.get("penalty") or {}).get("away")

            # Determine winner
            winner_db_id = None
            if status == "final" and ft_h is not None and ft_a is not None:
                if ft_h > ft_a:
                    winner_db_id = home_db_id
                elif ft_a > ft_h:
                    winner_db_id = away_db_id
                elif pn_h is not None and pn_a is not None:
                    if pn_h > pn_a:
                        winner_db_id = home_db_id
                    else:
                        winner_db_id = away_db_id

            # Store API fixture ID as match_number so sync_matches.py can find it
            api_fixture_id = fx["fixture"]["id"]

            await db.execute(
                """
                INSERT INTO matches (
                    stage, group_name, match_number,
                    home_team_id, away_team_id, venue_id,
                    scheduled_at, status,
                    ht_home, ht_away, ft_home, ft_away,
                    et_home, et_away, pen_home, pen_away,
                    winner_id
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                [
                    stage, group_ltr, api_fixture_id,
                    home_db_id, away_db_id, venue_db_id,
                    scheduled, status,
                    ht_h, ht_a, ft_h, ft_a,
                    et_h, et_a, pn_h, pn_a,
                    winner_db_id,
                ]
            )

            if stage == "group":
                n_group += 1
            else:
                n_knockout += 1

        print(f"    -> {n_group} group stage + {n_knockout} knockout fixtures inserted "
              f"({n_skip} skipped)")

    # =========================================================================
    # Summary report
    # =========================================================================
    print("\n========================================")
    print("  SEED COMPLETE — Data Summary")
    print("========================================")

    async with get_db() as db:
        team_count  = await db.fetchone("SELECT COUNT(*) AS n FROM teams")
        venue_count = await db.fetchone("SELECT COUNT(*) AS n FROM venues")
        match_count = await db.fetchone("SELECT COUNT(*) AS n FROM matches")
        grp_count   = await db.fetchone(
            "SELECT COUNT(DISTINCT group_name) AS n FROM teams WHERE group_name IS NOT NULL"
        )
        print(f"  Teams    : {team_count['n']}")
        print(f"  Groups   : {grp_count['n']}")
        print(f"  Venues   : {venue_count['n']}")
        print(f"  Matches  : {match_count['n']}")

        print("\n  Groups & Teams:")
        groups = await db.fetchall(
            "SELECT DISTINCT group_name FROM teams WHERE group_name IS NOT NULL ORDER BY group_name"
        )
        for g in groups:
            gname = g["group_name"]
            members = await db.fetchall(
                "SELECT name, code FROM teams WHERE group_name = ? ORDER BY name",
                [gname]
            )
            names = ", ".join(f"{r['name']} ({r['code']})" for r in members)
            print(f"    Group {gname}: {names}")

        print("\n  Earliest fixtures:")
        upcoming = await db.fetchall(
            """
            SELECT m.scheduled_at, ht.name AS home, at.name AS away,
                   m.group_name, v.name AS venue
            FROM matches m
            JOIN teams ht ON ht.id = m.home_team_id
            JOIN teams at ON at.id = m.away_team_id
            LEFT JOIN venues v ON v.id = m.venue_id
            WHERE m.stage = 'group'
            ORDER BY m.scheduled_at
            LIMIT 10
            """,
        )
        for r in upcoming:
            dt  = r["scheduled_at"][:16].replace("T", " ")
            grp = f"[Grp {r['group_name']}] " if r["group_name"] else ""
            ven = f" @ {r['venue']}" if r["venue"] else ""
            print(f"    {dt}  {grp}{r['home']} vs {r['away']}{ven}")

    print("\n[OK] Database seeded with real API-Football data.")


if __name__ == "__main__":
    asyncio.run(seed())
