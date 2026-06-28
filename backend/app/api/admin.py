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
    attendance: Optional[int] = None      # paid attendance (0 means clear it)
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
    # Convenience: if event_type == 'substitution_off' and this is provided,
    # the server auto-creates a linked 'substitution_on' event for the
    # incoming player (related_event_id = sub-off event's id).
    sub_on_player_id: Optional[int] = None


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


@router.post("/bracket/refill")
async def refill_bracket():
    """One-shot maintenance: (1) link any unlinked bracket rows to their
    matching match rows (pair by stage + slot↔match_number order), then
    (2) run _maybe_fill_bracket_from_group for every group whose matches are
    all final. The link step is what lets the auto-fill actually push teams
    into the matches table so the picks form / public match page see them.
    Idempotent and safe to re-run.

    NOTE: only auto-links R32 (where FIFA's bracket-slot → match-number
    convention is reliable). For r16/qf/sf/3rd/final the slot→match mapping
    has to be set explicitly via /admin/bracket — auto-pairing those gets
    the wrong winners into the wrong games."""
    async with get_db() as db:
        linked = await _link_bracket_to_matches(db, stages=("r32",))
        rows = await db.fetchall("""
            SELECT m.group_name
            FROM matches m
            WHERE m.group_name IS NOT NULL
            GROUP BY m.group_name
            HAVING SUM(CASE WHEN m.status = 'final' THEN 0 ELSE 1 END) = 0
        """)
        complete = [r["group_name"] for r in rows]
        thirds_filled = 0
        for g in complete:
            await _recompute_group_standings(db, g)
            # _maybe_fill_bracket_from_group also calls the thirds helper
            # at its end, so accumulate any returned count for the final
            # response. The bool below catches the case where the per-group
            # loop runs but no group's completion was the final missing one.
            await _maybe_fill_bracket_from_group(db, g)
        # Extra safety net: re-run the thirds check after all per-group
        # fills, in case the per-group helper is later split out. No-op
        # when the inner loop already wrote them.
        thirds_filled = await _maybe_fill_thirds_from_complete_groups(db)
        # Backfill knockout propagation for any KO match that finalised
        # before this propagation feature shipped. Iterate ALL final
        # knockout matches; each call is idempotent and stage-by-stage
        # ordering (r32 → r16 → qf → sf) means winners cascade naturally.
        ko_finals = await db.fetchall("""
            SELECT m.id FROM matches m
            WHERE m.group_name IS NULL
              AND m.status = 'final'
              AND m.winner_id IS NOT NULL
            ORDER BY CASE m.stage
              WHEN 'r32'         THEN 0
              WHEN 'r16'         THEN 1
              WHEN 'qf'          THEN 2
              WHEN 'sf'          THEN 3
              WHEN 'third_place' THEN 4
              WHEN 'final'       THEN 5
              ELSE 6 END, m.match_number
        """)
        ko_propagated = 0
        for r in ko_finals:
            ko_propagated += await _propagate_knockout_outcome(db, r["id"])
        # Catch-up mirror: copy bracket → matches for any linked row whose
        # match doesn't yet have the same teams. Needed for the case where
        # an earlier refill populated bracket teams BEFORE the linker had
        # set bracket.match_id, so _maybe_fill_bracket_from_group's
        # "nothing changed" early-exit skipped the matches UPDATE.
        mirrored = await _mirror_bracket_to_matches(db)
    return {
        "ok": True,
        "bracket_links_added": linked,
        "matches_mirrored":    mirrored,
        "thirds_filled":       thirds_filled,
        "ko_propagated":       ko_propagated,
        "complete_groups":     complete,
    }


# ---------------------------------------------------------------------------
# Bracket mapping admin endpoints
#
# The bracket rows know which seed_desc feeds them (e.g. "Winner Match 73 vs
# Winner Match 75") but NOT which scheduled match row in `matches` they
# correspond to. For R32 we auto-pair by match_number, but R16/QF/SF/Final
# need explicit admin mapping because FIFA's bracket-slot ordering doesn't
# align with chronological match numbering. These endpoints power the
# /admin/bracket mapping page.
# ---------------------------------------------------------------------------

@router.get("/bracket-mapping")
async def get_bracket_mapping():
    """Return every bracket row + every knockout match so the admin page
    can render dropdowns."""
    async with get_db() as db:
        slots = await db.fetchall("""
            SELECT b.id, b.stage, b.slot,
                   b.home_seed_desc, b.away_seed_desc,
                   b.match_id,
                   m.match_number   AS linked_match_number,
                   m.scheduled_at   AS linked_scheduled_at,
                   ht.code AS linked_home_code, ht.name AS linked_home_name,
                   at.code AS linked_away_code, at.name AS linked_away_name
            FROM bracket b
            LEFT JOIN matches m ON b.match_id = m.id
            LEFT JOIN teams ht  ON m.home_team_id = ht.id
            LEFT JOIN teams at  ON m.away_team_id = at.id
            ORDER BY
              CASE b.stage
                WHEN 'r32'         THEN 0
                WHEN 'r16'         THEN 1
                WHEN 'qf'          THEN 2
                WHEN 'sf'          THEN 3
                WHEN 'third_place' THEN 4
                WHEN 'final'       THEN 5
                ELSE 6 END,
              b.slot
        """)
        # Every knockout match — for populating the dropdowns
        matches = await db.fetchall("""
            SELECT m.id, m.stage, m.match_number, m.scheduled_at,
                   ht.code AS home_code, ht.name AS home_name,
                   at.code AS away_code, at.name AS away_name
            FROM matches m
            LEFT JOIN teams ht ON m.home_team_id = ht.id
            LEFT JOIN teams at ON m.away_team_id = at.id
            WHERE m.stage != 'group'
            ORDER BY m.stage, m.match_number
        """)
    return {"slots": slots, "matches": matches}


class BracketLinkUpdate(BaseModel):
    match_id: Optional[int] = None   # null = unlink


@router.put("/bracket/{bracket_id}/link")
async def link_bracket_slot(bracket_id: int, body: BracketLinkUpdate):
    """Set (or clear) which match row a bracket slot represents.

    Side effects when linking:
      - If the bracket row already has teams (e.g. R32 with both feeder
        groups complete), mirrors them into the newly-linked match row.
      - If the bracket row's seed_desc references a now-final upstream
        match (e.g. R16 slot whose seed says 'Winner Match 73' and #73
        is final), runs propagation so the team appears right away.
    """
    async with get_db() as db:
        slot = await db.fetchone(
            "SELECT id, stage, home_team_id, away_team_id, "
            "home_seed_desc, away_seed_desc FROM bracket WHERE id = ?",
            [bracket_id],
        )
        if not slot:
            raise HTTPException(404, "Bracket slot not found")
        if body.match_id is not None:
            m = await db.fetchone(
                "SELECT id, stage FROM matches WHERE id = ?", [body.match_id]
            )
            if not m:
                raise HTTPException(404, "Match not found")
            if m["stage"] != slot["stage"]:
                raise HTTPException(
                    400,
                    f"Stage mismatch: bracket slot is {slot['stage']}, "
                    f"match is {m['stage']}",
                )
        await db.execute(
            "UPDATE bracket SET match_id = ? WHERE id = ?",
            [body.match_id, bracket_id],
        )

        # If teams are already known on the bracket row, push them to the
        # freshly-linked match.
        if body.match_id is not None and (
            slot["home_team_id"] is not None or slot["away_team_id"] is not None
        ):
            await db.execute(
                "UPDATE matches SET home_team_id = ?, away_team_id = ?, "
                "updated_at = datetime('now') WHERE id = ?",
                [slot["home_team_id"], slot["away_team_id"], body.match_id],
            )

        # Run propagation from any final upstream match this slot references,
        # in case the linkage was missing when those upstream matches went
        # final.
        for side in ("home", "away"):
            parsed = _parse_match_outcome_seed(slot.get(f"{side}_seed_desc"))
            if parsed is None:
                continue
            num, _outcome = parsed
            upstream = await db.fetchone(
                "SELECT id FROM matches WHERE match_number = ? AND status = 'final'",
                [num],
            )
            if upstream:
                await _propagate_knockout_outcome(db, upstream["id"])
    return {"ok": True}


# Parses "Winner Match 73", "Winner of Match #89", "Loser Match 101", etc.
# Module-level import here because the group-seed parsers below also use the
# same `_re` alias (see line ~615 where `import re as _re` lives — but that
# scope is below us, so we re-import at module top for these helpers).
import re as _re_outcome
_MATCH_OUTCOME_RE = _re_outcome.compile(
    r"^\s*(winner|loser)\s+(?:of\s+)?(?:match\s+)?#?(\d+)\s*$",
    _re_outcome.I,
)


def _parse_match_outcome_seed(desc: Optional[str]) -> Optional[tuple[int, str]]:
    """For descriptors like 'Winner Match 73' return (73, 'winner'); for
    'Loser Match 101' return (101, 'loser'); else None."""
    if not desc:
        return None
    m = _MATCH_OUTCOME_RE.match(desc)
    if not m:
        return None
    return (int(m.group(2)), m.group(1).lower())


async def _propagate_knockout_outcome(db, match_id: int) -> int:
    """When this knockout match has a winner_id set, find any bracket slot
    whose home_seed_desc / away_seed_desc references this match's number
    (e.g. 'Winner Match 73') and write the team into it. Mirrors the same
    team into the linked downstream match row so the picks form and public
    match page see it immediately. Returns count of bracket sides updated.

    Safe to call on any match — no-op for matches that aren't final or
    that aren't referenced by any downstream bracket descriptor.
    """
    m = await db.fetchone(
        "SELECT match_number, status, winner_id, home_team_id, away_team_id "
        "FROM matches WHERE id = ?",
        [match_id],
    )
    if not m or m["status"] != "final" or m["winner_id"] is None:
        return 0
    if m["match_number"] is None:
        return 0
    # The "loser" half of the pair is the other team. Only meaningful when
    # both team ids are set (otherwise we can't identify the loser).
    winner_id = m["winner_id"]
    loser_id  = m["away_team_id"] if winner_id == m["home_team_id"] else m["home_team_id"]

    target_num = m["match_number"]
    slots = await db.fetchall(
        "SELECT id, match_id, home_team_id, away_team_id, "
        "home_seed_desc, away_seed_desc FROM bracket"
    )
    updated = 0
    for s in slots:
        new_home = s["home_team_id"]
        new_away = s["away_team_id"]
        for side in ("home", "away"):
            parsed = _parse_match_outcome_seed(s.get(f"{side}_seed_desc"))
            if parsed is None:
                continue
            num, outcome = parsed
            if num != target_num:
                continue
            # Skip when we can't identify the loser (would write NULL)
            tid = winner_id if outcome == "winner" else loser_id
            if tid is None:
                continue
            if side == "home":
                new_home = tid
            else:
                new_away = tid

        if new_home == s["home_team_id"] and new_away == s["away_team_id"]:
            continue
        await db.execute(
            "UPDATE bracket SET home_team_id = ?, away_team_id = ? WHERE id = ?",
            [new_home, new_away, s["id"]],
        )
        if s["match_id"] is not None:
            await db.execute(
                "UPDATE matches SET home_team_id = ?, away_team_id = ?, "
                "updated_at = datetime('now') WHERE id = ?",
                [new_home, new_away, s["match_id"]],
            )
        updated += 1
    return updated


async def _maybe_fill_thirds_from_complete_groups(db) -> int:
    """Once every group's matches are final, lock in the top-8 third-placed
    teams to their constrained bracket slots. Uses the same projection
    helpers as /api/bracket so the assignment matches what's been showing as
    'as it stands' all along. No-op while any group has unfinished matches
    or when the bipartite matcher can't fill all 8 slots (extreme edge case
    if the bracket constraints are mis-authored).

    Returns the count of bracket sides newly populated (across home + away).
    Also mirrors each change onto the linked match row so the picks form
    and public match page pick up the team."""
    # Lazy import: main.py imports admin's router at module top, so a
    # top-level import here would deadlock. Function-scope is safe.
    from app.main import (
        _current_group_rankings, _top_third_qualifiers,
        _assign_thirds_to_slots, _parse_third_groups,
    )

    pending = await db.fetchone(
        "SELECT COUNT(*) AS n FROM matches "
        "WHERE group_name IS NOT NULL AND status != 'final'"
    )
    if pending and pending["n"] > 0:
        return 0

    rankings   = await _current_group_rankings(db)
    qualifiers = _top_third_qualifiers(rankings, n=8)
    if len(qualifiers) < 8:
        return 0   # safety: not enough 3rd-placed teams to determine all 8

    bracket_rows = await db.fetchall(
        "SELECT id, match_id, home_team_id, away_team_id, "
        "home_seed_desc, away_seed_desc FROM bracket"
    )
    third_slots = [r for r in bracket_rows
                   if _parse_third_groups(r.get("home_seed_desc")) is not None
                   or _parse_third_groups(r.get("away_seed_desc")) is not None]
    assignment = _assign_thirds_to_slots(third_slots, qualifiers)

    # Only commit when the matcher finds the full 8-way assignment. A partial
    # result would mean the constraints aren't satisfiable and a manual look
    # is warranted; we'd rather keep showing italic projections than freeze
    # an inconsistent state.
    if len(assignment) < 8:
        return 0

    rows_by_id = {r["id"]: r for r in bracket_rows}
    written = 0
    for (slot_id, side), team_id in assignment.items():
        r = rows_by_id[slot_id]
        col = "home_team_id" if side == "home" else "away_team_id"
        if r[col] == team_id:
            continue   # already locked in
        await db.execute(
            f"UPDATE bracket SET {col} = ? WHERE id = ?",
            [team_id, slot_id],
        )
        if r["match_id"] is not None:
            await db.execute(
                f"UPDATE matches SET {col} = ?, updated_at = datetime('now') "
                f"WHERE id = ?",
                [team_id, r["match_id"]],
            )
        written += 1
    return written


async def _mirror_bracket_to_matches(db) -> int:
    """For every bracket row with match_id and at least one team set, make
    sure the linked match row has the same teams. Returns count of matches
    updated."""
    rows = await db.fetchall("""
        SELECT b.id, b.match_id, b.home_team_id AS b_home, b.away_team_id AS b_away,
               m.home_team_id AS m_home, m.away_team_id AS m_away
        FROM bracket b
        JOIN matches m ON b.match_id = m.id
        WHERE b.match_id IS NOT NULL
          AND (b.home_team_id IS NOT NULL OR b.away_team_id IS NOT NULL)
    """)
    updated = 0
    for r in rows:
        # Only overwrite a match-side team when the bracket has a real id
        # for it (preserve the match's existing values otherwise — e.g. for
        # half-filled brackets where only one feeder group is complete).
        new_home = r["b_home"] if r["b_home"] is not None else r["m_home"]
        new_away = r["b_away"] if r["b_away"] is not None else r["m_away"]
        if new_home == r["m_home"] and new_away == r["m_away"]:
            continue
        await db.execute(
            "UPDATE matches SET home_team_id = ?, away_team_id = ?, "
            "updated_at = datetime('now') WHERE id = ?",
            [new_home, new_away, r["match_id"]],
        )
        updated += 1
    return updated


async def _link_bracket_to_matches(
    db,
    stages: tuple[str, ...] = ("r32", "r16", "qf", "sf", "third_place", "final"),
) -> int:
    """For each requested knockout stage, pair the bracket rows (ordered by
    slot ASC) with the matches rows (ordered by match_number ASC) and write
    bracket.match_id where it's currently NULL.

    Only fills in NULL match_id values — won't disturb any manual links the
    admin has already set. Returns the count of rows newly linked.

    Callers usually restrict to r32 only because FIFA's bracket-slot ↔
    match-number convention is only reliable for the first knockout round;
    later rounds need explicit admin mapping via the bracket page."""
    total_linked = 0
    for stage in stages:
        b_rows = await db.fetchall(
            "SELECT id FROM bracket WHERE stage = ? AND match_id IS NULL "
            "ORDER BY slot ASC",
            [stage],
        )
        if not b_rows:
            continue
        m_rows = await db.fetchall(
            "SELECT id FROM matches WHERE stage = ? "
            "ORDER BY COALESCE(match_number, 999999), scheduled_at, id",
            [stage],
        )
        # Skip already-linked matches so we only pair unlinked-with-unlinked.
        taken = await db.fetchall(
            "SELECT match_id FROM bracket WHERE stage = ? AND match_id IS NOT NULL",
            [stage],
        )
        taken_ids = {t["match_id"] for t in taken}
        available_matches = [m for m in m_rows if m["id"] not in taken_ids]
        for b, m in zip(b_rows, available_matches):
            await db.execute(
                "UPDATE bracket SET match_id = ? WHERE id = ?",
                [m["id"], b["id"]],
            )
            total_linked += 1
    return total_linked


@router.get("/matches")
async def list_matches_for_admin():
    """Compact list used in the admin match picker."""
    async with get_db() as db:
        rows = await db.fetchall("""
            SELECT m.id, m.match_number, m.stage, m.group_name, m.scheduled_at,
                   m.status,
                   m.ht_home, m.ht_away, m.ft_home, m.ft_away,
                   m.et_home, m.et_away, m.pen_home, m.pen_away, m.winner_id,
                   m.attendance,
                   ht.id   AS home_id,   ht.name AS home_name, ht.code AS home_code,
                   ht.flag_url AS home_flag,
                   at.id   AS away_id,   at.name AS away_name, at.code AS away_code,
                   at.flag_url AS away_flag,
                   v.capacity AS venue_capacity
            FROM matches m
            LEFT JOIN teams ht ON m.home_team_id = ht.id
            LEFT JOIN teams at ON m.away_team_id = at.id
            LEFT JOIN venues v ON m.venue_id     = v.id
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
            # Attendance: 0 → clear back to NULL so % full hides; any other
            # int stays as-is. None means "don't touch" (typical PATCH).
            "attendance": (
                None if body.attendance == 0
                else body.attendance if body.attendance is not None
                else match.get("attendance")
            ),
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
                attendance = ?,
                updated_at = datetime('now')
            WHERE id = ?
        """, [merged["status"],
              merged["ht_home"], merged["ht_away"],
              merged["ft_home"], merged["ft_away"],
              merged["et_home"], merged["et_away"],
              merged["pen_home"], merged["pen_away"],
              winner_id, merged["attendance"], match_id])

        # Recompute group standings if the match has a group and is final
        if body.auto_recalc_standings and merged["status"] == "final" and match["group_name"]:
            await _recompute_group_standings(db, match["group_name"])
            # When all of this group's matches are final, push the winner +
            # runner-up into any bracket slots that reference them.
            await _maybe_fill_bracket_from_group(db, match["group_name"])

        # Knockout match just finished → push winner (and loser, for the
        # third-place playoff) into any downstream bracket slot whose
        # seed_desc reads "Winner Match N" / "Loser Match N".
        if (merged["status"] == "final"
                and (match.get("group_name") is None)
                and winner_id is not None):
            await _propagate_knockout_outcome(db, match_id)

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
# Bracket auto-fill
# ---------------------------------------------------------------------------

import re as _re   # local import to avoid polluting module namespace

# Matches "Winner Group A" / "Winner A" / "Winners A"
_GROUP_WINNER_RE   = _re.compile(r"^\s*winners?(?:\s+group)?\s+([A-Z])\s*$", _re.I)
# Matches "Runner-up Group B" / "Runner up B" / "Runners-up B" / "2nd Group B"
_GROUP_RUNNERUP_RE = _re.compile(
    r"^\s*(?:runners?[-\s]?up|2nd|second)(?:\s+place)?(?:\s+group)?\s+([A-Z])\s*$",
    _re.I,
)


def _parse_group_seed(desc: Optional[str]) -> Optional[tuple[str, int]]:
    """Return (group_letter, 1) for a winner descriptor, (group_letter, 2)
    for a runner-up descriptor, or None if it doesn't match either pattern
    (e.g. 'Best 3rd' / 'Winner SF1' / NULL)."""
    if not desc:
        return None
    m = _GROUP_WINNER_RE.match(desc)
    if m:
        return (m.group(1).upper(), 1)
    m = _GROUP_RUNNERUP_RE.match(desc)
    if m:
        return (m.group(1).upper(), 2)
    return None


async def _maybe_fill_bracket_from_group(db, group: str) -> None:
    """When every match in this group is final, look up winner + runner-up
    from the freshly-recomputed group_standings, then patch any bracket
    slots whose seed_desc references this group's 1st or 2nd place.

    Third-place qualification isn't resolved here — it depends on all
    groups being complete, so a separate sweep handles that.
    """
    # Bail out if the group still has unfinished matches
    pending = await db.fetchone(
        "SELECT COUNT(*) AS n FROM matches "
        "WHERE group_name = ? AND status != 'final'",
        [group],
    )
    if pending and pending["n"] > 0:
        return

    # Pull the same ordering used everywhere else (points, GD, GF)
    standings = await db.fetchall("""
        SELECT team_id, points, goal_diff, goals_for
        FROM group_standings
        WHERE group_name = ?
        ORDER BY points DESC, goal_diff DESC, goals_for DESC, team_id
    """, [group])
    if len(standings) < 2:
        return  # safety: malformed group

    winner_id    = standings[0]["team_id"]
    runner_up_id = standings[1]["team_id"]
    pos_to_team  = {1: winner_id, 2: runner_up_id}

    # Find any bracket slot that references this group's 1st or 2nd
    slots = await db.fetchall(
        "SELECT id, match_id, home_team_id, away_team_id, "
        "home_seed_desc, away_seed_desc FROM bracket"
    )
    for s in slots:
        new_home = s["home_team_id"]
        new_away = s["away_team_id"]
        for side in ("home", "away"):
            parsed = _parse_group_seed(s[f"{side}_seed_desc"])
            if parsed is None:
                continue
            grp, pos = parsed
            if grp != group:
                continue
            tid = pos_to_team[pos]
            if side == "home":
                new_home = tid
            else:
                new_away = tid

        if new_home == s["home_team_id"] and new_away == s["away_team_id"]:
            continue   # nothing changed

        await db.execute(
            "UPDATE bracket SET home_team_id = ?, away_team_id = ? WHERE id = ?",
            [new_home, new_away, s["id"]],
        )
        # Mirror the same team change onto the linked R32 match row so the
        # admin's match editor and the public match page both pick it up.
        if s["match_id"] is not None:
            await db.execute(
                "UPDATE matches SET home_team_id = ?, away_team_id = ?, "
                "updated_at = datetime('now') WHERE id = ?",
                [new_home, new_away, s["match_id"]],
            )

    # If THIS group's completion was the last one missing, the top-8 thirds
    # are now fully determined too — lock those in.
    await _maybe_fill_thirds_from_complete_groups(db)


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

        # Auto-create the partner 'substitution_on' event when one is provided
        sub_on_id = None
        if (body.event_type == "substitution_off"
                and body.sub_on_player_id
                and body.sub_on_player_id != body.player_id
                and new_id is not None):
            srows = await db.execute("""
                INSERT INTO match_events
                  (match_id, team_id, player_id, event_type, minute, added_time, period,
                   is_penalty, is_own_goal, related_event_id)
                VALUES (?,?,?,'substitution_on',?,?,?,0,0,?)
                RETURNING id
            """, [match_id, body.team_id, body.sub_on_player_id,
                  body.minute, body.added_time, body.period, new_id])
            sub_on_id = srows[0]["id"] if srows else None

        # Refresh derived stats — events changed
        await _recompute_derived_stats(db, match_id)

        # Auto-sync live score from goal events (skips other event types)
        if body.event_type in ("goal", "own_goal"):
            await _recompute_score_from_events(db, match_id)

        # First-scorer may have changed → re-score family picks
        from app.api.compete import recompute_match_points
        await recompute_match_points(db, match_id)

    return {"ok": True, "id": new_id, "assist_id": assist_id, "sub_on_id": sub_on_id}


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
            await _recompute_score_from_events(db, ev["match_id"])
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

async def _recompute_score_from_events(db, match_id: int) -> None:
    """Sync match.ft_home / match.ft_away with the goal events on this match.

    Counts:
      home_goals = (regular goals by home team) + (own goals by away team)
      away_goals = (regular goals by away team) + (own goals by home team)

    Called whenever a goal event is added or deleted so the public live score
    updates automatically. Admin can still manually override via the score
    panel, but the next goal event will re-sync.
    """
    m = await db.fetchone(
        "SELECT home_team_id, away_team_id FROM matches WHERE id = ?", [match_id]
    )
    if not m or m["home_team_id"] is None or m["away_team_id"] is None:
        return

    events = await db.fetchall(
        "SELECT team_id, event_type, is_own_goal FROM match_events "
        "WHERE match_id = ? AND event_type IN ('goal', 'own_goal')",
        [match_id]
    )
    home, away = 0, 0
    for e in events:
        # own_goal flag (or 'own_goal' type) credits the OPPOSING team
        is_own = e["event_type"] == "own_goal" or bool(e["is_own_goal"])
        scoring_team = m["away_team_id"] if (is_own and e["team_id"] == m["home_team_id"]) \
                        else m["home_team_id"] if (is_own and e["team_id"] == m["away_team_id"]) \
                        else e["team_id"]
        if scoring_team == m["home_team_id"]:
            home += 1
        elif scoring_team == m["away_team_id"]:
            away += 1

    await db.execute(
        "UPDATE matches SET ft_home = ?, ft_away = ?, updated_at = datetime('now') "
        "WHERE id = ?",
        [home, away, match_id]
    )


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
        "SELECT player_id, team_id, event_type, minute, is_own_goal "
        "FROM match_events WHERE match_id = ?",
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

    def exit_minute(pid: int) -> Optional[int]:
        """Earliest minute the player left the pitch — whichever comes first:
        substituted off OR sent off (straight red or second yellow). Returns
        None if the player finished the match on the pitch."""
        candidates = [
            evmin(pid, "substitution_off"),
            evmin(pid, "red_card"),
            evmin(pid, "yellow_red_card"),
        ]
        actual = [m for m in candidates if m is not None]
        return min(actual) if actual else None

    for lp in lineup:
        pid       = lp["player_id"]
        is_start  = bool(lp["is_starter"])
        exit_min  = exit_minute(pid)
        sub_on    = evmin(pid, "substitution_on")

        # Minutes played heuristic — user can override later via stats form
        if is_start:
            mins = exit_min if exit_min is not None else 90
        elif sub_on is not None:
            mins = max(0, (exit_min if exit_min is not None else 90) - sub_on)
        else:
            mins = 0  # named in squad but didn't come on

        # Own goals do NOT credit the scorer's goal tally — they're stored on
        # the defender's row with is_own_goal=1, but only count toward the
        # opposing team's score, never the player's stats.
        goals    = sum(1 for e in events
                       if e["player_id"] == pid
                       and e["event_type"] == "goal"
                       and not e["is_own_goal"])
        assists  = evcount(pid, {"assist"})
        yellow   = evcount(pid, {"yellow_card", "yellow_red_card"})
        red      = evcount(pid, {"red_card", "yellow_red_card"})

        # Upsert. Manual columns (passes, tackles, etc.) default to 0 on first
        # insert and are NOT overwritten on subsequent updates.
        # Derived columns (minutes, goals, assists, cards) ARE overwritten so
        # they always reflect current lineup + events.
        await db.execute("""
            INSERT INTO player_match_stats
              (match_id, team_id, player_id, is_starter, minutes_played,
               goals, assists, yellow_cards, red_cards)
            VALUES (?,?,?,?,?,?,?,?,?)
            ON CONFLICT(match_id, player_id) DO UPDATE SET
              is_starter      = excluded.is_starter,
              minutes_played  = excluded.minutes_played,
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
