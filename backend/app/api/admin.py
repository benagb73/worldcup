"""
app/api/admin.py
Hidden admin endpoints for live in-game updates.

All routes are gated by an X-Admin-Secret header that must match the
SYNC_SECRET env var. There are no links from the public site — the admin UI
lives at /admin in the frontend and is only reachable if you know the URL.
"""

from __future__ import annotations

import os
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel

from app.db.connection import get_db


SYNC_SECRET = os.getenv("SYNC_SECRET", "dev-secret")


# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------

async def require_admin(x_admin_secret: str = Header(...)) -> None:
    if x_admin_secret != SYNC_SECRET:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid admin secret")


router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_admin)],
)


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class MatchUpdate(BaseModel):
    status: Optional[str] = None         # scheduled, live, live_et, live_penalties, final, postponed
    ht_home: Optional[int] = None
    ht_away: Optional[int] = None
    ft_home: Optional[int] = None
    ft_away: Optional[int] = None
    et_home: Optional[int] = None
    et_away: Optional[int] = None
    pen_home: Optional[int] = None
    pen_away: Optional[int] = None
    winner_id: Optional[int] = None       # explicit override; recalculated otherwise
    auto_recalc_standings: bool = True    # rebuild group standings after a final score


class EventCreate(BaseModel):
    team_id: int
    player_id: int
    event_type: str          # goal, own_goal, goal_penalty_miss, assist,
                             # yellow_card, yellow_red_card, red_card,
                             # substitution_off, substitution_on
    minute: int
    added_time: int = 0
    period: str = "normal"   # normal, extra_time_1, extra_time_2, penalties
    is_penalty: bool = False
    is_own_goal: bool = False
    related_event_id: Optional[int] = None
    # Convenience: if event_type == 'goal' and this is provided, the server
    # auto-creates a linked 'assist' event with related_event_id = goal's id.
    assist_player_id: Optional[int] = None


class MatchTeams(BaseModel):
    home_team_id: Optional[int] = None
    away_team_id: Optional[int] = None


class LineupPlayerIn(BaseModel):
    player_id: int
    is_starter: bool
    position_played: Optional[str] = None
    shirt_number: Optional[int] = None


class LineupSet(BaseModel):
    team_id: int
    players: list[LineupPlayerIn]   # full replacement of the team's lineup for this match


class StatsRow(BaseModel):
    player_id: int
    # Editable / manual fields — the ones the user fills in by watching the match
    passes_completed: int = 0
    passes_attempted: int = 0
    tackles_made: int = 0
    shots_total: int = 0
    shots_on_target: int = 0
    fouls_committed: int = 0
    fouls_won: int = 0
    saves: int = 0
    goals_conceded: int = 0
    # Allow overriding the auto-derived minutes (e.g. extra-time matches)
    minutes_played: Optional[int] = None


class StatsBulk(BaseModel):
    rows: list[StatsRow]


# ---------------------------------------------------------------------------
# Health / auth-check
# ---------------------------------------------------------------------------

@router.get("/whoami")
async def whoami():
    """If this returns 200 the supplied secret is valid. Used by the admin UI."""
    return {"ok": True}


# ---------------------------------------------------------------------------
# Matches — list + per-match editing
# ---------------------------------------------------------------------------

@router.put("/matches/{match_id}/teams")
async def set_match_teams(match_id: int, body: MatchTeams):
    """Wire actual teams into a knockout placeholder match once winners are known."""
    async with get_db() as db:
        m = await db.fetchone("SELECT id, stage FROM matches WHERE id = ?", [match_id])
        if not m:
            raise HTTPException(404, "Match not found")
        await db.execute(
            "UPDATE matches SET home_team_id = ?, away_team_id = ?, updated_at = datetime('now') "
            "WHERE id = ?",
            [body.home_team_id, body.away_team_id, match_id]
        )
    return {"ok": True}


@router.get("/teams")
async def list_teams():
    """All teams — used in the admin team-picker for knockouts."""
    async with get_db() as db:
        rows = await db.fetchall(
            "SELECT id, name, code, group_name, flag_url, world_rank "
            "FROM teams ORDER BY name"
        )
    return rows


@router.get("/matches")
async def list_matches_for_admin():
    """Compact list used in the admin match picker."""
    async with get_db() as db:
        rows = await db.fetchall("""
            SELECT m.id, m.match_number, m.stage, m.group_name, m.scheduled_at,
                   m.status,
                   m.ht_home, m.ht_away, m.ft_home, m.ft_away,
                   m.et_home, m.et_away, m.pen_home, m.pen_away, m.winner_id,
                   ht.id   AS home_id,   ht.name AS home_name, ht.code AS home_code,
                   ht.flag_url AS home_flag,
                   at.id   AS away_id,   at.name AS away_name, at.code AS away_code,
                   at.flag_url AS away_flag
            FROM matches m
            LEFT JOIN teams ht ON m.home_team_id = ht.id
            LEFT JOIN teams at ON m.away_team_id = at.id
            ORDER BY m.scheduled_at
        """)
    return rows


@router.patch("/matches/{match_id}")
async def update_match(match_id: int, body: MatchUpdate):
    """Update score / status. Auto-derives winner_id from scoreline if not given."""
    async with get_db() as db:
        match = await db.fetchone("SELECT * FROM matches WHERE id = ?", [match_id])
        if not match:
            raise HTTPException(404, "Match not found")

        merged = {
            "status":   body.status   if body.status   is not None else match["status"],
            "ht_home":  body.ht_home  if body.ht_home  is not None else match["ht_home"],
            "ht_away":  body.ht_away  if body.ht_away  is not None else match["ht_away"],
            "ft_home":  body.ft_home  if body.ft_home  is not None else match["ft_home"],
            "ft_away":  body.ft_away  if body.ft_away  is not None else match["ft_away"],
            "et_home":  body.et_home  if body.et_home  is not None else match["et_home"],
            "et_away":  body.et_away  if body.et_away  is not None else match["et_away"],
            "pen_home": body.pen_home if body.pen_home is not None else match["pen_home"],
            "pen_away": body.pen_away if body.pen_away is not None else match["pen_away"],
        }

        # Derive winner_id when status is final, unless user provided one explicitly
        if body.winner_id is not None:
            winner_id = body.winner_id
        elif merged["status"] == "final":
            winner_id = _derive_winner(match["home_team_id"], match["away_team_id"], merged)
        else:
            winner_id = match["winner_id"]

        await db.execute("""
            UPDATE matches SET
                status   = ?,
                ht_home  = ?, ht_away  = ?,
                ft_home  = ?, ft_away  = ?,
                et_home  = ?, et_away  = ?,
                pen_home = ?, pen_away = ?,
                winner_id = ?,
                updated_at = datetime('now')
            WHERE id = ?
        """, [merged["status"],
              merged["ht_home"], merged["ht_away"],
              merged["ft_home"], merged["ft_away"],
              merged["et_home"], merged["et_away"],
              merged["pen_home"], merged["pen_away"],
              winner_id, match_id])

        # Recompute group standings if the match has a group and is final
        if body.auto_recalc_standings and merged["status"] == "final" and match["group_name"]:
            await _recompute_group_standings(db, match["group_name"])

        # Score any family-competition picks attached to this match
        from app.api.compete import recompute_match_points
        await recompute_match_points(db, match_id)

    return {"ok": True, "winner_id": winner_id}


def _derive_winner(home_id: int, away_id: int, m: dict) -> Optional[int]:
    """Determine winner from the layered score columns."""
    # Penalty shootout decides if present
    if m["pen_home"] is not None and m["pen_away"] is not None:
        if m["pen_home"] > m["pen_away"]: return home_id
        if m["pen_away"] > m["pen_home"]: return away_id
    if m["et_home"] is not None and m["et_away"] is not None:
        if m["et_home"] > m["et_away"]: return home_id
        if m["et_away"] > m["et_home"]: return away_id
    if m["ft_home"] is not None and m["ft_away"] is not None:
        if m["ft_home"] > m["ft_away"]: return home_id
        if m["ft_away"] > m["ft_home"]: return away_id
    return None


async def _recompute_group_standings(db, group: str) -> None:
    """Wipe + recompute standings for the whole group from finished matches."""
    matches = await db.fetchall("""
        SELECT home_team_id, away_team_id, ft_home, ft_away
        FROM matches
        WHERE group_name = ? AND status = 'final'
    """, [group])

    totals: dict[int, dict] = {}
    for m in matches:
        h, a = m["ft_home"] or 0, m["ft_away"] or 0
        for tid in (m["home_team_id"], m["away_team_id"]):
            if tid not in totals:
                totals[tid] = dict(played=0, won=0, drawn=0, lost=0, gf=0, ga=0)
        totals[m["home_team_id"]]["played"] += 1
        totals[m["away_team_id"]]["played"] += 1
        totals[m["home_team_id"]]["gf"] += h
        totals[m["home_team_id"]]["ga"] += a
        totals[m["away_team_id"]]["gf"] += a
        totals[m["away_team_id"]]["ga"] += h
        if   h > a:
            totals[m["home_team_id"]]["won"]  += 1
            totals[m["away_team_id"]]["lost"] += 1
        elif a > h:
            totals[m["away_team_id"]]["won"]  += 1
            totals[m["home_team_id"]]["lost"] += 1
        else:
            totals[m["home_team_id"]]["drawn"] += 1
            totals[m["away_team_id"]]["drawn"] += 1

    # Reset row for every team currently in this group, then upsert totals
    teams_in_group = await db.fetchall(
        "SELECT id FROM teams WHERE group_name = ?", [group]
    )
    for t in teams_in_group:
        tid = t["id"]
        stats = totals.get(tid, dict(played=0, won=0, drawn=0, lost=0, gf=0, ga=0))
        await db.execute("""
            INSERT INTO group_standings
              (group_name, team_id, played, won, drawn, lost, goals_for, goals_against)
            VALUES (?,?,?,?,?,?,?,?)
            ON CONFLICT(group_name, team_id) DO UPDATE SET
              played        = excluded.played,
              won           = excluded.won,
              drawn         = excluded.drawn,
              lost          = excluded.lost,
              goals_for     = excluded.goals_for,
              goals_against = excluded.goals_against
        """, [group, tid, stats["played"], stats["won"], stats["drawn"],
              stats["lost"], stats["gf"], stats["ga"]])


# ---------------------------------------------------------------------------
# Events — list, add, delete
# ---------------------------------------------------------------------------

@router.get("/matches/{match_id}/events")
async def list_match_events(match_id: int):
    async with get_db() as db:
        rows = await db.fetchall("""
            SELECT me.*, p.name AS player_name, t.code AS team_code
            FROM match_events me
            JOIN players p ON me.player_id = p.id
            JOIN teams   t ON me.team_id   = t.id
            WHERE me.match_id = ?
            ORDER BY me.period, me.minute, me.added_time, me.id
        """, [match_id])
    return rows


@router.post("/matches/{match_id}/events")
async def add_match_event(match_id: int, body: EventCreate):
    async with get_db() as db:
        match = await db.fetchone("SELECT id FROM matches WHERE id = ?", [match_id])
        if not match:
            raise HTTPException(404, "Match not found")

        rows = await db.execute("""
            INSERT INTO match_events
              (match_id, team_id, player_id, event_type, minute, added_time, period,
               is_penalty, is_own_goal, related_event_id)
            VALUES (?,?,?,?,?,?,?,?,?,?)
            RETURNING id
        """, [match_id, body.team_id, body.player_id, body.event_type,
              body.minute, body.added_time, body.period,
              int(body.is_penalty), int(body.is_own_goal),
              body.related_event_id])
        new_id = rows[0]["id"] if rows else None

        # Auto-create the linked assist event when a goal scorer + assister are
        # submitted together. Skip for own goals and penalty-miss "goal" types.
        assist_id = None
        if (body.event_type == "goal"
                and not body.is_own_goal
                and body.assist_player_id
                and body.assist_player_id != body.player_id
                and new_id is not None):
            arows = await db.execute("""
                INSERT INTO match_events
                  (match_id, team_id, player_id, event_type, minute, added_time, period,
                   is_penalty, is_own_goal, related_event_id)
                VALUES (?,?,?,'assist',?,?,?,0,0,?)
                RETURNING id
            """, [match_id, body.team_id, body.assist_player_id,
                  body.minute, body.added_time, body.period, new_id])
            assist_id = arows[0]["id"] if arows else None

        # Refresh derived stats — events changed
        await _recompute_derived_stats(db, match_id)

        # First-scorer may have changed → re-score family picks
        from app.api.compete import recompute_match_points
        await recompute_match_points(db, match_id)

    return {"ok": True, "id": new_id, "assist_id": assist_id}


@router.delete("/events/{event_id}")
async def delete_event(event_id: int):
    async with get_db() as db:
        # Look up the match_id before deletion so we can rebuild derived stats
        ev = await db.fetchone("SELECT match_id FROM match_events WHERE id = ?", [event_id])
        # Clear any related_event_id references first to keep FKs valid
        await db.execute(
            "UPDATE match_events SET related_event_id = NULL WHERE related_event_id = ?",
            [event_id]
        )
        await db.execute("DELETE FROM match_events WHERE id = ?", [event_id])

        if ev and ev.get("match_id") is not None:
            await _recompute_derived_stats(db, ev["match_id"])
            from app.api.compete import recompute_match_points
            await recompute_match_points(db, ev["match_id"])
    return {"ok": True}


# ---------------------------------------------------------------------------
# Derived-stats helper
#
# We treat goals/assists/cards as derived from the events table and
# minutes_played as derived from lineup + substitution events. The user only
# manually edits the harder-to-derive numbers (passes, tackles, shots, fouls,
# saves, conceded). Whenever a lineup or event changes we rebuild the derived
# columns in player_match_stats, leaving the manual columns untouched.
# ---------------------------------------------------------------------------

async def _recompute_derived_stats(db, match_id: int) -> None:
    """Sync player_match_stats with the current lineup + events for one match.

    Adds rows for new lineup players, removes rows for players who got cut
    from the lineup, and refreshes the derived columns
    (is_starter, minutes_played, goals, assists, yellow_cards, red_cards)
    everywhere. Manual columns (passes, tackles, etc.) are preserved.
    """
    lineup = await db.fetchall(
        "SELECT team_id, player_id, is_starter FROM match_lineups WHERE match_id = ?",
        [match_id]
    )
    events = await db.fetchall(
        "SELECT player_id, team_id, event_type, minute FROM match_events WHERE match_id = ?",
        [match_id]
    )

    # Delete any stats rows for players no longer in the lineup
    lineup_pids = {lp["player_id"] for lp in lineup}
    existing = await db.fetchall(
        "SELECT player_id FROM player_match_stats WHERE match_id = ?", [match_id]
    )
    for r in existing:
        if r["player_id"] not in lineup_pids:
            await db.execute(
                "DELETE FROM player_match_stats WHERE match_id = ? AND player_id = ?",
                [match_id, r["player_id"]]
            )

    # Per-player event tallies
    def evcount(pid: int, types: set[str]) -> int:
        return sum(1 for e in events if e["player_id"] == pid and e["event_type"] in types)

    def evmin(pid: int, etype: str) -> Optional[int]:
        return next((e["minute"] for e in events if e["player_id"] == pid and e["event_type"] == etype), None)

    for lp in lineup:
        pid       = lp["player_id"]
        is_start  = bool(lp["is_starter"])
        sub_off   = evmin(pid, "substitution_off")
        sub_on    = evmin(pid, "substitution_on")

        # Minutes played heuristic — user can override later via stats form
        if is_start:
            mins = sub_off if sub_off is not None else 90
        elif sub_on is not None:
            mins = max(0, 90 - sub_on)
        else:
            mins = 0  # named in squad but didn't come on

        goals    = evcount(pid, {"goal"})
        assists  = evcount(pid, {"assist"})
        yellow   = evcount(pid, {"yellow_card", "yellow_red_card"})
        red      = evcount(pid, {"red_card", "yellow_red_card"})

        # Upsert. Manual columns default to 0 on first insert (via schema) and
        # are NOT overwritten on subsequent updates.
        await db.execute("""
            INSERT INTO player_match_stats
              (match_id, team_id, player_id, is_starter, minutes_played,
               goals, assists, yellow_cards, red_cards)
            VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(match_id, player_id) DO UPDATE SET
              is_starter      = excluded.is_starter,
              minutes_played  = CASE
                                  WHEN player_match_stats.minutes_played IS NULL
                                       OR player_match_stats.minutes_played = 0
                                       OR player_match_stats.is_starter   != excluded.is_starter
                                  THEN excluded.minutes_played
                                  ELSE player_match_stats.minutes_played
                                END,
              goals           = excluded.goals,
              assists         = excluded.assists,
              yellow_cards    = excluded.yellow_cards,
              red_cards       = excluded.red_cards
        """, [match_id, lp["team_id"], pid, int(is_start), mins,
              goals, assists, yellow, red])


# ---------------------------------------------------------------------------
# Lineups — full set per (match, team)
# ---------------------------------------------------------------------------

@router.put("/matches/{match_id}/lineup")
async def set_lineup(match_id: int, body: LineupSet):
    """Replace the lineup for one team in this match (starters + bench)."""
    async with get_db() as db:
        match = await db.fetchone("SELECT id FROM matches WHERE id = ?", [match_id])
        if not match:
            raise HTTPException(404, "Match not found")

        # Wipe existing rows for this team in this match
        await db.execute(
            "DELETE FROM match_lineups WHERE match_id = ? AND team_id = ?",
            [match_id, body.team_id]
        )
        for p in body.players:
            await db.execute("""
                INSERT INTO match_lineups
                  (match_id, team_id, player_id, is_starter, position_played, shirt_number)
                VALUES (?,?,?,?,?,?)
            """, [match_id, body.team_id, p.player_id,
                  int(p.is_starter), p.position_played, p.shirt_number])

        # Sync derived stats for the new lineup (creates zeroed rows for new
        # players, removes rows for players cut from the lineup).
        await _recompute_derived_stats(db, match_id)
    return {"ok": True, "count": len(body.players)}


# ---------------------------------------------------------------------------
# Per-match player stats — list + bulk update
# ---------------------------------------------------------------------------

@router.get("/matches/{match_id}/stats")
async def list_match_stats(match_id: int):
    """Return all player_match_stats rows for this match (one per player in lineup),
    re-syncing derived columns first."""
    async with get_db() as db:
        await _recompute_derived_stats(db, match_id)
        rows = await db.fetchall("""
            SELECT pms.match_id, pms.team_id, pms.player_id, pms.is_starter,
                   pms.minutes_played, pms.goals, pms.assists,
                   pms.shots_total, pms.shots_on_target,
                   pms.passes_completed, pms.passes_attempted,
                   pms.tackles_made,
                   pms.fouls_committed, pms.fouls_won,
                   pms.yellow_cards, pms.red_cards,
                   pms.saves, pms.goals_conceded,
                   p.name AS player_name, p.position AS player_position,
                   p.shirt_number AS player_shirt,
                   t.code AS team_code
            FROM player_match_stats pms
            JOIN players p ON pms.player_id = p.id
            JOIN teams   t ON pms.team_id   = t.id
            WHERE pms.match_id = ?
            ORDER BY pms.team_id, pms.is_starter DESC,
                     COALESCE(p.shirt_number, 99), p.name
        """, [match_id])
    return rows


@router.put("/matches/{match_id}/stats")
async def bulk_update_stats(match_id: int, body: StatsBulk):
    """Bulk-update only the manually-editable columns for each player.
    Derived columns (G/A/Y/R) are NOT overwritten here — they're rebuilt from
    events. minutes_played gets overwritten only if the client sends a value."""
    async with get_db() as db:
        for r in body.rows:
            sets = [
                "passes_completed = ?",
                "passes_attempted = ?",
                "tackles_made     = ?",
                "shots_total      = ?",
                "shots_on_target  = ?",
                "fouls_committed  = ?",
                "fouls_won        = ?",
                "saves            = ?",
                "goals_conceded   = ?",
            ]
            params = [
                r.passes_completed, r.passes_attempted, r.tackles_made,
                r.shots_total, r.shots_on_target,
                r.fouls_committed, r.fouls_won,
                r.saves, r.goals_conceded,
            ]
            if r.minutes_played is not None:
                sets.append("minutes_played = ?")
                params.append(r.minutes_played)
            params.extend([match_id, r.player_id])

            await db.execute(
                f"UPDATE player_match_stats SET {', '.join(sets)} "
                f"WHERE match_id = ? AND player_id = ?",
                params
            )
    return {"ok": True, "count": len(body.rows)}


# ---------------------------------------------------------------------------
# Lookups — teams + their squads, for populating dropdowns in the admin UI
# ---------------------------------------------------------------------------

@router.get("/teams/{team_id}/players")
async def team_roster(team_id: int):
    async with get_db() as db:
        rows = await db.fetchall("""
            SELECT id, name, shirt_number, position
            FROM players WHERE team_id = ?
            ORDER BY shirt_number, name
        """, [team_id])
    return rows
