"""
sync/sync_matches.py

Pulls live and recently finished match data from API-Football
and upserts into the database.

Set env vars:
  API_FOOTBALL_KEY   — your RapidAPI key for api-sports.io
  API_FOOTBALL_HOST  — api-football-v3.p.rapidapi.com  (default)
  WC_SEASON          — e.g. 2026
  WC_LEAGUE_ID       — FIFA World Cup league id on API-Football (1 for WC)
"""

import os
import httpx
from datetime import datetime, timezone

from app.db.connection import get_db

API_KEY    = os.getenv("API_FOOTBALL_KEY", "")
API_HOST   = os.getenv("API_FOOTBALL_HOST", "v3.football.api-sports.io")
SEASON     = os.getenv("WC_SEASON", "2026")
LEAGUE_ID  = os.getenv("WC_LEAGUE_ID", "1")

_USE_RAPIDAPI = "rapidapi" in API_HOST.lower()
HEADERS = (
    {"X-RapidAPI-Key": API_KEY, "X-RapidAPI-Host": API_HOST}
    if _USE_RAPIDAPI
    else {"x-apisports-key": API_KEY}
)

BASE = f"https://{API_HOST}"


# ---------------------------------------------------------------------------
# Status mapping — API-Football → our schema
# ---------------------------------------------------------------------------
STATUS_MAP = {
    "TBD": "scheduled", "NS": "scheduled",
    "1H": "live",  "HT": "live", "2H": "live", "ET": "live_et",
    "BT": "live_et", "P": "live_penalties", "INT": "live",
    "FT": "final",  "AET": "final", "PEN": "final",
    "SUSP": "postponed", "PST": "postponed", "CANC": "postponed",
}

PERIOD_MAP = {
    "1H": "normal", "HT": "normal", "2H": "normal",
    "ET": "extra_time_1", "BT": "extra_time_2",
    "P":  "penalties",
}

EVENT_TYPE_MAP = {
    "Goal":         "goal",
    "Card":         None,          # resolved by detail field
    "subst":        "substitution_off",
    "Var":          None,          # skip VAR review events
    "Miss":         "goal_penalty_miss",
}


async def _get(client: httpx.AsyncClient, path: str, params: dict) -> dict:
    r = await client.get(f"{BASE}{path}", params=params, headers=HEADERS, timeout=15)
    r.raise_for_status()
    return r.json()


async def run_sync():
    """Main entry point — called by /api/sync and the scheduler."""
    if not API_KEY:
        print("⚠  API_FOOTBALL_KEY not set — skipping sync")
        return

    async with httpx.AsyncClient() as client:
        # 1. Fetch all live fixtures first, then today's finished ones
        live_data     = await _get(client, "/v3/fixtures", {"live": "all", "league": LEAGUE_ID, "season": SEASON})
        today         = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        finished_data = await _get(client, "/v3/fixtures", {"date": today, "league": LEAGUE_ID, "season": SEASON})

        fixtures = live_data.get("response", []) + finished_data.get("response", [])
        seen = set()
        for fx in fixtures:
            fid = fx["fixture"]["id"]
            if fid in seen:
                continue
            seen.add(fid)
            await _sync_fixture(client, fx)

    print(f"✓ Sync complete — processed {len(seen)} fixtures")


async def _sync_fixture(client: httpx.AsyncClient, fx: dict):
    fixture   = fx["fixture"]
    teams     = fx["teams"]
    goals     = fx["goals"]
    score     = fx["score"]
    api_status = fixture["status"]["short"]
    status    = STATUS_MAP.get(api_status, "scheduled")

    ext_id = str(fixture["id"])  # API-Football fixture ID stored in match.match_number for mapping

    async with get_db() as db:
        # Find our match by external id stored in match_number field
        # (During seeding we store the API fixture id there)
        match_row = await db.fetchone(
            "SELECT id, home_team_id, away_team_id FROM matches WHERE match_number = ?",
            [ext_id]
        )
        if not match_row:
            return  # Not seeded yet — skip

        match_id = match_row["id"]

        # Update match scores & status
        ht_h = score["halftime"]["home"]
        ht_a = score["halftime"]["away"]
        ft_h = score["fulltime"]["home"]
        ft_a = score["fulltime"]["away"]
        et_h = score["extratime"]["home"]
        et_a = score["extratime"]["away"]
        pn_h = score["penalty"]["home"]
        pn_a = score["penalty"]["away"]

        await db.execute("""
            UPDATE matches SET
              status    = ?,
              ht_home   = ?, ht_away = ?,
              ft_home   = ?, ft_away = ?,
              et_home   = ?, et_away = ?,
              pen_home  = ?, pen_away = ?,
              updated_at = datetime('now')
            WHERE id = ?
        """, [status, ht_h, ht_a, ft_h, ft_a, et_h, et_a, pn_h, pn_a, match_id])

        # Fetch and sync events
        ev_data = await _get(client, "/v3/fixtures/events", {"fixture": fixture["id"]})
        await _sync_events(db, match_id, match_row, ev_data.get("response", []))

        # Fetch and sync lineups
        lu_data = await _get(client, "/v3/fixtures/lineups", {"fixture": fixture["id"]})
        await _sync_lineups(db, match_id, lu_data.get("response", []))

        # Fetch and sync player stats
        ps_data = await _get(client, "/v3/fixtures/players", {"fixture": fixture["id"]})
        await _sync_player_stats(db, match_id, ps_data.get("response", []))

        # Update group standings if finished
        if status == "final":
            await _update_standings(db, match_id)


async def _sync_events(db, match_id: int, match_row: dict, api_events: list):
    """Upsert match events. We clear and re-insert for idempotency."""
    # Only clear non-manually-entered events (all for now)
    await db.execute("DELETE FROM match_events WHERE match_id = ?", [match_id])

    insert_sql = """
        INSERT INTO match_events
          (match_id, team_id, player_id, event_type, minute, added_time, period,
           is_penalty, is_own_goal, related_event_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
    """

    goal_events: dict = {}  # (team_id, minute) → event rowid, for linking assists

    for ev in api_events:
        raw_type = ev.get("type", "")
        detail   = ev.get("detail", "")
        minute   = ev.get("time", {}).get("elapsed", 0)
        extra    = ev.get("time", {}).get("extra") or 0
        api_team = ev.get("team", {})
        player   = ev.get("player", {})
        assist   = ev.get("assist", {})

        # Resolve team
        team_id = await _resolve_team(db, api_team)
        if not team_id:
            continue

        # Resolve player
        player_id = await _resolve_player(db, player, team_id)
        if not player_id:
            continue

        # Determine period
        period = "normal"
        if minute > 90:
            period = "extra_time_1" if minute <= 105 else "extra_time_2"

        # Map event type
        if raw_type == "Goal":
            is_penalty = "Penalty" in detail
            is_own     = "Own Goal" in detail
            event_type = "own_goal" if is_own else "goal"
            rows = await db.execute(insert_sql,
                [match_id, team_id, player_id, event_type, minute, extra, period, is_penalty, is_own])
            # Store for assist linking — simplified; real linking uses last inserted rowid
            goal_events[(team_id, minute)] = player_id

            # Assist
            if assist and assist.get("id") and not is_own:
                assist_id = await _resolve_player(db, assist, team_id)
                if assist_id:
                    await db.execute(insert_sql,
                        [match_id, team_id, assist_id, "assist", minute, extra, period, 0, 0])

        elif raw_type == "Card":
            if "Yellow" in detail and "Red" not in detail:
                event_type = "yellow_card"
            elif "Red" in detail and "Yellow" not in detail:
                event_type = "red_card"
            else:
                event_type = "yellow_red_card"
            await db.execute(insert_sql,
                [match_id, team_id, player_id, event_type, minute, extra, period, 0, 0])

        elif raw_type == "subst":
            # Player off
            await db.execute(insert_sql,
                [match_id, team_id, player_id, "substitution_off", minute, extra, period, 0, 0])
            # Player on
            if assist and assist.get("id"):
                sub_on_id = await _resolve_player(db, assist, team_id)
                if sub_on_id:
                    await db.execute(insert_sql,
                        [match_id, team_id, sub_on_id, "substitution_on", minute, extra, period, 0, 0])

        elif raw_type == "Miss":
            await db.execute(insert_sql,
                [match_id, team_id, player_id, "goal_penalty_miss", minute, extra, period, 1, 0])


async def _sync_lineups(db, match_id: int, api_lineups: list):
    await db.execute("DELETE FROM match_lineups WHERE match_id = ?", [match_id])

    for team_lu in api_lineups:
        api_team = team_lu.get("team", {})
        team_id  = await _resolve_team(db, api_team)
        if not team_id:
            continue

        for p in team_lu.get("startXI", []):
            pi = p.get("player", {})
            player_id = await _resolve_player(db, pi, team_id)
            if player_id:
                await db.execute("""
                    INSERT OR IGNORE INTO match_lineups
                      (match_id, team_id, player_id, is_starter, position_played, shirt_number)
                    VALUES (?, ?, ?, 1, ?, ?)
                """, [match_id, team_id, player_id, pi.get("pos"), pi.get("number")])

        for p in team_lu.get("substitutes", []):
            pi = p.get("player", {})
            player_id = await _resolve_player(db, pi, team_id)
            if player_id:
                await db.execute("""
                    INSERT OR IGNORE INTO match_lineups
                      (match_id, team_id, player_id, is_starter, position_played, shirt_number)
                    VALUES (?, ?, ?, 0, ?, ?)
                """, [match_id, team_id, player_id, pi.get("pos"), pi.get("number")])


async def _sync_player_stats(db, match_id: int, api_teams: list):
    await db.execute("DELETE FROM player_match_stats WHERE match_id = ?", [match_id])

    for team_data in api_teams:
        api_team = team_data.get("team", {})
        team_id  = await _resolve_team(db, api_team)
        if not team_id:
            continue

        for p in team_data.get("players", []):
            pi    = p.get("player", {})
            stats = p.get("statistics", [{}])[0]
            games = stats.get("games", {})
            shots = stats.get("shots", {})
            goals = stats.get("goals", {})
            passes = stats.get("passes", {})
            tackles = stats.get("tackles", {})
            cards = stats.get("cards", {})

            player_id = await _resolve_player(db, pi, team_id)
            if not player_id:
                continue

            position = games.get("position", "")
            is_gk    = position == "G"
            minutes  = games.get("minutes") or 0

            await db.execute("""
                INSERT OR REPLACE INTO player_match_stats (
                  match_id, player_id, team_id, is_starter, minutes_played,
                  goals, assists, shots_total, shots_on_target,
                  passes_completed, passes_attempted, tackles_made,
                  interceptions, clearances, yellow_cards, red_cards,
                  saves, goals_conceded, penalty_saves,
                  penalties_taken, penalties_scored
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, [
                match_id, player_id, team_id,
                1 if games.get("lineups") else 0,
                minutes,
                goals.get("total") or 0,
                goals.get("assists") or 0,
                shots.get("total") or 0,
                shots.get("on") or 0,
                passes.get("accuracy") or 0,
                passes.get("total") or 0,
                tackles.get("total") or 0,
                tackles.get("interceptions") or 0,
                tackles.get("blocks") or 0,
                cards.get("yellow") or 0,
                cards.get("red") or 0,
                goals.get("saves") or 0 if is_gk else 0,
                goals.get("conceded") or 0 if is_gk else 0,
                goals.get("penaltysaves") or 0 if is_gk else 0,
                0, 0,  # penalties_taken/scored tracked via events
            ])


async def _update_standings(db, match_id: int):
    """Recalculate standings for the groups involved in this match."""
    match = await db.fetchone(
        "SELECT group_name, home_team_id, away_team_id, ft_home, ft_away FROM matches WHERE id = ?",
        [match_id]
    )
    if not match or not match["group_name"]:
        return  # Knockout match — no standings to update

    group = match["group_name"]
    home_id, away_id = match["home_team_id"], match["away_team_id"]
    fth, fta = match["ft_home"] or 0, match["ft_away"] or 0

    # Recompute from scratch for the whole group
    group_matches = await db.fetchall("""
        SELECT home_team_id, away_team_id, ft_home, ft_away
        FROM matches WHERE group_name = ? AND status = 'final'
    """, [group])

    totals: dict[int, dict] = {}
    for gm in group_matches:
        for tid in [gm["home_team_id"], gm["away_team_id"]]:
            if tid not in totals:
                totals[tid] = dict(played=0, won=0, drawn=0, lost=0, gf=0, ga=0)

        h, a = gm["ft_home"] or 0, gm["ft_away"] or 0
        totals[gm["home_team_id"]]["played"] += 1
        totals[gm["away_team_id"]]["played"] += 1
        totals[gm["home_team_id"]]["gf"] += h
        totals[gm["home_team_id"]]["ga"] += a
        totals[gm["away_team_id"]]["gf"] += a
        totals[gm["away_team_id"]]["ga"] += h

        if h > a:
            totals[gm["home_team_id"]]["won"] += 1
            totals[gm["away_team_id"]]["lost"] += 1
        elif h < a:
            totals[gm["away_team_id"]]["won"] += 1
            totals[gm["home_team_id"]]["lost"] += 1
        else:
            totals[gm["home_team_id"]]["drawn"] += 1
            totals[gm["away_team_id"]]["drawn"] += 1

    for tid, t in totals.items():
        await db.execute("""
            INSERT INTO group_standings (group_name, team_id, played, won, drawn, lost, goals_for, goals_against)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(group_name, team_id) DO UPDATE SET
              played        = excluded.played,
              won           = excluded.won,
              drawn         = excluded.drawn,
              lost          = excluded.lost,
              goals_for     = excluded.goals_for,
              goals_against = excluded.goals_against
        """, [group, tid, t["played"], t["won"], t["drawn"], t["lost"], t["gf"], t["ga"]])


# ---------------------------------------------------------------------------
# Player / team resolution helpers
# ---------------------------------------------------------------------------

async def _resolve_team(db, api_team: dict) -> int | None:
    """Find our team_id from API-Football team data."""
    name = api_team.get("name", "")
    row  = await db.fetchone("SELECT id FROM teams WHERE name = ?", [name])
    return row["id"] if row else None


async def _resolve_player(db, api_player: dict, team_id: int) -> int | None:
    """Find or create a player record."""
    name = api_player.get("name", "")
    if not name:
        return None
    row = await db.fetchone(
        "SELECT id FROM players WHERE name = ? AND team_id = ?", [name, team_id]
    )
    if row:
        return row["id"]

    # Auto-create minimal record — club info can be filled in via seeding
    cur = await db.execute(
        "INSERT INTO players (team_id, name) VALUES (?, ?) RETURNING id",
        [team_id, name]
    )
    if cur:
        return cur[0]["id"]
    return None
