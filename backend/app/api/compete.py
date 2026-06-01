"""
app/api/compete.py
Family prediction-competition endpoints.

Workflow:
  1. Anyone joins via POST /api/compete/competitors (name + team_name)
  2. Each competitor edits their picks before each match's scheduled_at
     via PUT /api/compete/competitors/{id}/picks/{match_id}
  3. When a match flips to status='final' the scoring engine awards points

Scoring (all values stored in the comp_scoring single-row table):
  result_points          — picked winner / draw correctly
  both_scores_points     — picked the exact scoreline
  one_score_points       — picked just one team's goal count (mutually exclusive
                           with both_scores_points; the bigger reward wins)
  first_scorer_points    — picked the first true goalscorer (or 'no goal')
  joker_multiplier       — multiplies the final per-match total
  pen_winner_bonus_goal  — in knockouts decided on penalties, this many goals
                           are added to the shootout winner's "effective" score
                           for scoring comparison purposes

Joker buckets — caps how many jokers a competitor can play per phase:
  group-1, group-2, group-3  (one per group matchday): 2 each
  r32, r16, qf, sf, final:                              1 each
  third_place:                                          0
"""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from app.db.connection import get_db


router = APIRouter(prefix="/api/compete", tags=["compete"])


# ---------------------------------------------------------------------------
# Joker bucket helper
# ---------------------------------------------------------------------------

JOKER_CAPS = {
    "group-1":    2,
    "group-2":    2,
    "group-3":    2,
    "r32":        1,
    "r16":        1,
    "qf":         1,
    "sf":         1,
    "final":      1,
    "third_place": 0,
}


async def _build_bucket_map(db) -> dict[int, str]:
    """Compute every match's joker bucket in ONE query.

    Returns {match_id: bucket}. Group matchday is derived in Python from the
    chronological order within each group (each team plays 3 games → 6 fixtures
    per group, split into 3 matchdays of 2 games each).

    Endpoints that need a bucket for one match should call this once at the
    top of the request and look up in the resulting dict — avoids the
    per-match query that previously triggered an N+1 (200+ Turso round trips
    on the picks page).
    """
    rows = await db.fetchall(
        "SELECT id, stage, group_name, scheduled_at FROM matches "
        "ORDER BY group_name, scheduled_at, id"
    )
    # Index group-stage matches by group letter in chronological order
    group_lists: dict[str, list[int]] = {}
    for m in rows:
        if m["stage"] == "group" and m["group_name"]:
            group_lists.setdefault(m["group_name"], []).append(m["id"])

    out: dict[int, str] = {}
    for m in rows:
        mid = m["id"]
        if m["stage"] != "group":
            out[mid] = m["stage"]               # 'r32', 'r16', 'qf', 'sf', etc.
            continue
        gn = m["group_name"]
        if not gn:
            out[mid] = "group-1"                 # shouldn't happen with real data
            continue
        try:
            idx = group_lists[gn].index(mid)
        except ValueError:
            idx = 0
        out[mid] = f"group-{(idx // 2) + 1}"     # 1, 2, or 3
    return out


async def _bucket_for_match(db, match_id: int) -> str:
    """Single-match version — only used by the PUT pick endpoint where we
    need just one lookup. Internally builds the full map (still one query)."""
    bmap = await _build_bucket_map(db)
    if match_id not in bmap:
        raise HTTPException(404, "Match not found")
    return bmap[match_id]


# ---------------------------------------------------------------------------
# Scoring engine
# ---------------------------------------------------------------------------

async def _scoring_config(db) -> dict:
    row = await db.fetchone("SELECT * FROM comp_scoring WHERE id = 1")
    return row or {
        "result_points": 2, "both_scores_points": 5, "one_score_points": 1,
        "first_scorer_points": 3, "joker_multiplier": 2,
        "pen_winner_bonus_goal": 1,
    }


def _effective_score(match: dict, pen_winner_bonus_goal: int) -> tuple[int, int]:
    """Pick the layered score columns to use for scoring comparison.

    For knockout games decided on penalties, the shootout winner gets
    `pen_winner_bonus_goal` virtual goals added to their effective score so
    competitors who picked the right winner get rewarded even when the
    in-play scoreline was a draw.
    """
    pen_h, pen_a = match.get("pen_home"), match.get("pen_away")
    et_h,  et_a  = match.get("et_home"),  match.get("et_away")
    ft_h,  ft_a  = match.get("ft_home"),  match.get("ft_away")

    if pen_h is not None and pen_a is not None:
        # Use ET score if available, otherwise FT
        base_h = et_h if et_h is not None else (ft_h or 0)
        base_a = et_a if et_a is not None else (ft_a or 0)
        if pen_h > pen_a:
            return base_h + pen_winner_bonus_goal, base_a
        return base_h, base_a + pen_winner_bonus_goal
    if et_h is not None and et_a is not None:
        return et_h, et_a
    return (ft_h or 0), (ft_a or 0)


def _result(h: int, a: int) -> str:
    if h > a:  return "home"
    if a > h:  return "away"
    return "tie"


async def _first_scorer_player_id(db, match_id: int) -> Optional[int]:
    """Player who scored the first true goal of the match, or None if 0-0.

    Own goals and missed penalties are excluded.
    """
    row = await db.fetchone("""
        SELECT player_id FROM match_events
        WHERE match_id = ? AND event_type = 'goal' AND is_own_goal = 0
        ORDER BY
          CASE period
            WHEN 'normal'        THEN 0
            WHEN 'extra_time_1'  THEN 1
            WHEN 'extra_time_2'  THEN 2
            WHEN 'penalties'     THEN 3
            ELSE 4
          END,
          minute, added_time, id
        LIMIT 1
    """, [match_id])
    return row["player_id"] if row else None


def _score_pick(pick: dict, eff_h: int, eff_a: int,
                actual_first_scorer: Optional[int],
                config: dict) -> int:
    """Compute points for one pick row against a finalised match."""
    points = 0

    # Result
    if _result(pick["home_score"], pick["away_score"]) == _result(eff_h, eff_a):
        points += config["result_points"]

    # Score correctness
    home_match = pick["home_score"] == eff_h
    away_match = pick["away_score"] == eff_a
    if home_match and away_match:
        points += config["both_scores_points"]
    elif home_match or away_match:
        points += config["one_score_points"]

    # First scorer — None ↔ None means "no goal" pick matched a 0-0
    pick_pid = pick["first_scorer_player_id"]
    if pick.get("no_goal"):
        pick_pid = None
    if pick_pid == actual_first_scorer:
        points += config["first_scorer_points"]

    # Joker doubles the total
    if pick.get("is_joker"):
        points *= config["joker_multiplier"]

    return points


async def recompute_match_points(db, match_id: int) -> None:
    """Award points for every pick on a match. Idempotent — safe to call
    on every match status change."""
    match = await db.fetchone(
        "SELECT id, status, ft_home, ft_away, et_home, et_away, "
        "pen_home, pen_away FROM matches WHERE id = ?",
        [match_id]
    )
    if not match:
        return

    if match["status"] != "final":
        # Clear points so an accidental update doesn't leave stale awards behind
        await db.execute(
            "UPDATE picks SET points_awarded = NULL WHERE match_id = ?",
            [match_id]
        )
        return

    config = await _scoring_config(db)
    eff_h, eff_a = _effective_score(match, config["pen_winner_bonus_goal"])
    first_scorer = await _first_scorer_player_id(db, match_id)

    picks = await db.fetchall("SELECT * FROM picks WHERE match_id = ?", [match_id])
    for p in picks:
        pts = _score_pick(p, eff_h, eff_a, first_scorer, config)
        await db.execute(
            "UPDATE picks SET points_awarded = ?, updated_at = datetime('now') "
            "WHERE id = ?",
            [pts, p["id"]]
        )


# ---------------------------------------------------------------------------
# Tournament-start helper (for warnings on config changes)
# ---------------------------------------------------------------------------

async def tournament_started(db) -> bool:
    row = await db.fetchone(
        "SELECT 1 AS x FROM matches WHERE status != 'scheduled' AND status != 'postponed' LIMIT 1"
    )
    return bool(row)


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class CompetitorIn(BaseModel):
    name:      str = Field(min_length=1, max_length=80)
    team_name: str = Field(min_length=1, max_length=40)


class PoolIn(BaseModel):
    slug: str = Field(min_length=1, max_length=40,
                      pattern=r"^[a-z0-9][a-z0-9\-]*$")   # url-safe
    name: str = Field(min_length=1, max_length=60)


class PoolJoinIn(BaseModel):
    """Either supply an existing competitor_id to add, OR new_name + new_team_name
    to create a fresh competitor in this pool."""
    competitor_id:  Optional[int] = None
    new_name:       Optional[str] = None
    new_team_name:  Optional[str] = None


class PickIn(BaseModel):
    home_score:             int = Field(ge=0, le=20)
    away_score:             int = Field(ge=0, le=20)
    first_scorer_player_id: Optional[int] = None
    no_goal:                bool = False
    is_joker:               bool = False


# ---------------------------------------------------------------------------
# Public endpoints
# ---------------------------------------------------------------------------

@router.get("/scoring")
async def get_scoring():
    async with get_db() as db:
        c = await _scoring_config(db)
        started = await tournament_started(db)
    return {**c, "tournament_started": started}


# ---------------------------------------------------------------------------
# Pools
# ---------------------------------------------------------------------------

@router.get("/pools")
async def list_pools():
    """All pools with their member count + total points across members."""
    async with get_db() as db:
        rows = await db.fetchall("""
            SELECT
              po.id, po.slug, po.name, po.created_at,
              COUNT(DISTINCT pm.competitor_id) AS member_count
            FROM pools po
            LEFT JOIN pool_members pm ON pm.pool_id = po.id
            GROUP BY po.id
            ORDER BY po.id
        """)
    return rows


@router.get("/pools/{slug}")
async def get_pool(slug: str):
    """Pool detail + leaderboard (only members of this pool)."""
    async with get_db() as db:
        p = await db.fetchone(
            "SELECT id, slug, name, created_at FROM pools WHERE slug = ?",
            [slug]
        )
        if not p:
            raise HTTPException(404, "Pool not found")

        members = await db.fetchall("""
            SELECT
              c.id, c.name, c.team_name, c.created_at,
              COUNT(pk.id)                       AS picks_made,
              COALESCE(SUM(pk.points_awarded),0) AS total_points,
              COUNT(CASE WHEN pk.is_joker = 1 THEN 1 END)             AS jokers_played,
              COUNT(CASE WHEN pk.points_awarded IS NOT NULL THEN 1 END) AS matches_scored
            FROM pool_members pm
            JOIN competitors c ON c.id = pm.competitor_id
            LEFT JOIN picks pk ON pk.competitor_id = c.id
            WHERE pm.pool_id = ?
            GROUP BY c.id
            ORDER BY total_points DESC, c.name
        """, [p["id"]])
    return {**p, "members": members}


@router.post("/pools")
async def create_pool(body: PoolIn):
    slug = body.slug.strip().lower()
    name = body.name.strip()
    async with get_db() as db:
        existing = await db.fetchone("SELECT id FROM pools WHERE slug = ?", [slug])
        if existing:
            raise HTTPException(409, f"Pool slug '{slug}' is already taken")
        rows = await db.execute(
            "INSERT INTO pools (slug, name) VALUES (?, ?) RETURNING id",
            [slug, name]
        )
    return {"ok": True, "id": rows[0]["id"] if rows else None, "slug": slug}


@router.post("/pools/{slug}/members")
async def join_pool(slug: str, body: PoolJoinIn):
    """Add an existing competitor to a pool, OR create a new competitor and
    add them in one shot.

    Body shapes:
      {"competitor_id": 5}                                 ← add existing
      {"new_name": "Sam", "new_team_name": "Sam's Side"}   ← create + add
    """
    async with get_db() as db:
        pool = await db.fetchone("SELECT id FROM pools WHERE slug = ?", [slug])
        if not pool:
            raise HTTPException(404, "Pool not found")

        competitor_id: int
        if body.competitor_id is not None:
            comp = await db.fetchone(
                "SELECT id FROM competitors WHERE id = ?", [body.competitor_id]
            )
            if not comp:
                raise HTTPException(404, "Competitor not found")
            competitor_id = body.competitor_id
        else:
            if not body.new_name or not body.new_team_name:
                raise HTTPException(400,
                    "Provide either competitor_id or both new_name + new_team_name")
            taken = await db.fetchone(
                "SELECT id FROM competitors WHERE LOWER(team_name) = LOWER(?)",
                [body.new_team_name.strip()]
            )
            if taken:
                raise HTTPException(409,
                    f"Team name '{body.new_team_name}' is already taken")
            rows = await db.execute(
                "INSERT INTO competitors (name, team_name) VALUES (?,?) RETURNING id",
                [body.new_name.strip(), body.new_team_name.strip()]
            )
            competitor_id = rows[0]["id"] if rows else 0

        # Idempotent — re-joining the same pool is harmless
        await db.execute("""
            INSERT OR IGNORE INTO pool_members (pool_id, competitor_id)
            VALUES (?, ?)
        """, [pool["id"], competitor_id])
    return {"ok": True, "competitor_id": competitor_id}


@router.get("/competitors/{competitor_id}/pools")
async def competitor_pools(competitor_id: int):
    """All pools this competitor is in — used by the competitor page to
    show "Joined pools" + offer a "Join another" form."""
    async with get_db() as db:
        comp = await db.fetchone("SELECT id FROM competitors WHERE id = ?", [competitor_id])
        if not comp:
            raise HTTPException(404, "Competitor not found")
        rows = await db.fetchall("""
            SELECT po.id, po.slug, po.name, pm.joined_at
            FROM pool_members pm
            JOIN pools po ON po.id = pm.pool_id
            WHERE pm.competitor_id = ?
            ORDER BY pm.joined_at
        """, [competitor_id])
    return rows


@router.get("/competitors")
async def list_competitors():
    async with get_db() as db:
        rows = await db.fetchall("""
            SELECT
              c.id, c.name, c.team_name, c.created_at,
              COUNT(p.id)                  AS picks_made,
              COALESCE(SUM(p.points_awarded), 0) AS total_points,
              COUNT(CASE WHEN p.is_joker = 1 THEN 1 END)        AS jokers_played,
              COUNT(CASE WHEN p.points_awarded IS NOT NULL THEN 1 END) AS matches_scored
            FROM competitors c
            LEFT JOIN picks p ON p.competitor_id = c.id
            GROUP BY c.id
            ORDER BY total_points DESC, c.name
        """)
    return rows


@router.post("/competitors")
async def create_competitor(body: CompetitorIn):
    async with get_db() as db:
        # team_name is unique — surface a clean error
        existing = await db.fetchone(
            "SELECT id FROM competitors WHERE LOWER(team_name) = LOWER(?)",
            [body.team_name.strip()]
        )
        if existing:
            raise HTTPException(409, f"Team name '{body.team_name}' is already taken")
        rows = await db.execute(
            "INSERT INTO competitors (name, team_name) VALUES (?, ?) RETURNING id",
            [body.name.strip(), body.team_name.strip()]
        )
        new_id = rows[0]["id"] if rows else None
        # Auto-add to the default Family pool so legacy /compete/join flow keeps working
        if new_id is not None:
            await db.execute(
                "INSERT OR IGNORE INTO pool_members (pool_id, competitor_id) "
                "SELECT id, ? FROM pools WHERE slug = 'family'",
                [new_id]
            )
    return {"ok": True, "id": new_id}


@router.get("/competitors/{competitor_id}")
async def get_competitor(competitor_id: int):
    async with get_db() as db:
        c = await db.fetchone(
            "SELECT id, name, team_name, created_at FROM competitors WHERE id = ?",
            [competitor_id]
        )
        if not c:
            raise HTTPException(404, "Competitor not found")

        # Aggregate joker usage per bucket so the UI can show "1/2 left" etc.
        picks = await db.fetchall("""
            SELECT p.match_id, p.is_joker, p.points_awarded,
                   m.stage, m.group_name, m.scheduled_at
            FROM picks p
            JOIN matches m ON p.match_id = m.id
            WHERE p.competitor_id = ?
        """, [competitor_id])

        jokers_used: dict[str, int] = {k: 0 for k in JOKER_CAPS}
        if any(p["is_joker"] for p in picks):
            bmap = await _build_bucket_map(db)
            for p in picks:
                if not p["is_joker"]:
                    continue
                bucket = bmap.get(p["match_id"], "group-1")
                jokers_used[bucket] = jokers_used.get(bucket, 0) + 1

        total_points = sum((p["points_awarded"] or 0) for p in picks)
    return {
        "id": c["id"], "name": c["name"], "team_name": c["team_name"],
        "created_at": c["created_at"],
        "total_points": total_points,
        "picks_made": len(picks),
        "jokers_used": jokers_used,
        "joker_caps": JOKER_CAPS,
    }


@router.get("/competitors/{competitor_id}/picks")
async def list_picks(
    competitor_id: int,
    x_competitor_id: Optional[str] = Header(None),
):
    """All matches × this competitor's pick (NULL fields where no pick yet).

    Pre-kickoff pick details are hidden from anyone whose X-Competitor-Id
    header doesn't match the URL competitor_id (i.e. someone other than the
    owner). The owner is identified by localStorage on the client. This is
    family-honor-system security, not cryptographic.
    """
    is_owner = False
    if x_competitor_id is not None:
        try:
            is_owner = int(x_competitor_id) == competitor_id
        except ValueError:
            is_owner = False
    async with get_db() as db:
        if not await db.fetchone("SELECT id FROM competitors WHERE id = ?", [competitor_id]):
            raise HTTPException(404, "Competitor not found")
        rows = await db.fetchall("""
            SELECT
              m.id AS match_id, m.stage, m.group_name, m.match_number,
              m.scheduled_at, m.status,
              m.ft_home, m.ft_away, m.et_home, m.et_away,
              m.pen_home, m.pen_away, m.winner_id,
              ht.id AS home_id, ht.name AS home_name, ht.code AS home_code, ht.flag_url AS home_flag,
              at.id AS away_id, at.name AS away_name, at.code AS away_code, at.flag_url AS away_flag,
              p.id          AS pick_id,
              p.home_score  AS pick_home,
              p.away_score  AS pick_away,
              p.first_scorer_player_id,
              p.no_goal,
              p.is_joker,
              p.points_awarded,
              fp.name       AS first_scorer_name
            FROM matches m
            LEFT JOIN teams ht ON m.home_team_id = ht.id
            LEFT JOIN teams at ON m.away_team_id = at.id
            LEFT JOIN picks p  ON p.match_id = m.id AND p.competitor_id = ?
            LEFT JOIN players fp ON fp.id = p.first_scorer_player_id
            ORDER BY m.scheduled_at, m.id
        """, [competitor_id])

        # Tag each row with its joker bucket so the UI can render caps.
        # When viewer is not the owner, scrub pick details for pre-kickoff matches.
        bmap = await _build_bucket_map(db)        # ← one query instead of N
        now = datetime.now(timezone.utc)
        out = []
        for r in rows:
            bucket = bmap.get(r["match_id"], "group-1")
            row = {**r, "joker_bucket": bucket}
            if not is_owner:
                try:
                    ko = datetime.fromisoformat(row["scheduled_at"].replace("Z", "+00:00"))
                except Exception:
                    ko = None
                pre_kickoff = (row["status"] == "scheduled"
                               and ko is not None and now < ko)
                if pre_kickoff and row.get("pick_id") is not None:
                    # Indicate "pick exists, hidden" so the UI can show a lock icon
                    row["pick_hidden"]            = True
                    row["pick_home"]              = None
                    row["pick_away"]              = None
                    row["first_scorer_player_id"] = None
                    row["first_scorer_name"]      = None
                    row["no_goal"]                = None
                    row["is_joker"]               = None
                else:
                    row["pick_hidden"] = False
            else:
                row["pick_hidden"] = False
            out.append(row)
    return out


@router.put("/competitors/{competitor_id}/picks/{match_id}")
async def upsert_pick(competitor_id: int, match_id: int, body: PickIn):
    async with get_db() as db:
        comp = await db.fetchone("SELECT id FROM competitors WHERE id = ?", [competitor_id])
        if not comp:
            raise HTTPException(404, "Competitor not found")
        m = await db.fetchone(
            "SELECT id, status, scheduled_at, stage FROM matches WHERE id = ?",
            [match_id]
        )
        if not m:
            raise HTTPException(404, "Match not found")

        # Deadline check — picks lock at kickoff
        if m["status"] != "scheduled":
            raise HTTPException(409, f"Picks closed — match is {m['status']}")
        try:
            kickoff = datetime.fromisoformat(m["scheduled_at"].replace("Z", "+00:00"))
        except Exception:
            kickoff = None
        if kickoff and datetime.now(timezone.utc) >= kickoff:
            raise HTTPException(409, "Picks closed — match has kicked off")

        # Validate first-scorer choice
        first_id: Optional[int] = body.first_scorer_player_id
        if body.no_goal:
            first_id = None
        if first_id is not None:
            # Make sure the player belongs to one of the two teams playing
            played = await db.fetchone("""
                SELECT 1 AS x FROM players p
                JOIN matches mm ON mm.home_team_id = p.team_id OR mm.away_team_id = p.team_id
                WHERE p.id = ? AND mm.id = ?
            """, [first_id, match_id])
            if not played:
                raise HTTPException(400, "First scorer must play for one of the two teams")

        # Joker validation
        if body.is_joker:
            bmap = await _build_bucket_map(db)
            bucket = bmap.get(match_id)
            if bucket is None:
                raise HTTPException(404, "Match not found")
            cap = JOKER_CAPS.get(bucket, 0)
            if cap == 0:
                raise HTTPException(400, f"No jokers allowed for {bucket} matches")

            # Count current jokers already used in this bucket (excluding this match)
            used_rows = await db.fetchall("""
                SELECT p.match_id FROM picks p
                WHERE p.competitor_id = ? AND p.is_joker = 1 AND p.match_id != ?
            """, [competitor_id, match_id])
            in_bucket = sum(1 for r in used_rows if bmap.get(r["match_id"]) == bucket)
            if in_bucket >= cap:
                raise HTTPException(409,
                    f"Joker limit reached for {bucket} ({in_bucket}/{cap})")

        await db.execute("""
            INSERT INTO picks
              (competitor_id, match_id, home_score, away_score,
               first_scorer_player_id, no_goal, is_joker)
            VALUES (?,?,?,?,?,?,?)
            ON CONFLICT(competitor_id, match_id) DO UPDATE SET
              home_score             = excluded.home_score,
              away_score             = excluded.away_score,
              first_scorer_player_id = excluded.first_scorer_player_id,
              no_goal                = excluded.no_goal,
              is_joker               = excluded.is_joker,
              updated_at             = datetime('now')
        """, [competitor_id, match_id, body.home_score, body.away_score,
              first_id, int(body.no_goal), int(body.is_joker)])
    return {"ok": True}


@router.get("/matches/{match_id}/picks")
async def list_match_picks(match_id: int):
    """All competitors' picks for one match. Locked to post-kickoff so nobody can spy on
    open games."""
    async with get_db() as db:
        m = await db.fetchone(
            "SELECT id, status, scheduled_at, stage, group_name, "
            "ft_home, ft_away, et_home, et_away, pen_home, pen_away "
            "FROM matches WHERE id = ?", [match_id]
        )
        if not m:
            raise HTTPException(404, "Match not found")

        # Hide picks until kickoff
        try:
            kickoff = datetime.fromisoformat(m["scheduled_at"].replace("Z", "+00:00"))
        except Exception:
            kickoff = None
        before_kickoff = (
            m["status"] == "scheduled"
            and kickoff is not None
            and datetime.now(timezone.utc) < kickoff
        )
        if before_kickoff:
            raise HTTPException(403, "Picks are hidden until kickoff")

        rows = await db.fetchall("""
            SELECT
              c.id          AS competitor_id,
              c.name        AS competitor_name,
              c.team_name,
              p.home_score,
              p.away_score,
              p.first_scorer_player_id,
              p.no_goal,
              p.is_joker,
              p.points_awarded,
              fp.name       AS first_scorer_name
            FROM picks p
            JOIN competitors c ON c.id = p.competitor_id
            LEFT JOIN players fp ON fp.id = p.first_scorer_player_id
            WHERE p.match_id = ?
            ORDER BY
              CASE WHEN p.points_awarded IS NULL THEN 1 ELSE 0 END,
              p.points_awarded DESC,
              c.team_name
        """, [match_id])
    return {
        "match": {
            "id": m["id"], "status": m["status"], "stage": m["stage"],
            "group_name": m.get("group_name"),
            "scheduled_at": m["scheduled_at"],
            "ft_home": m.get("ft_home"), "ft_away": m.get("ft_away"),
            "et_home": m.get("et_home"), "et_away": m.get("et_away"),
            "pen_home": m.get("pen_home"), "pen_away": m.get("pen_away"),
        },
        "picks": rows,
    }


@router.delete("/competitors/{competitor_id}/picks/{match_id}")
async def delete_pick(competitor_id: int, match_id: int):
    async with get_db() as db:
        m = await db.fetchone("SELECT status FROM matches WHERE id = ?", [match_id])
        if not m:
            raise HTTPException(404, "Match not found")
        if m["status"] != "scheduled":
            raise HTTPException(409, "Picks closed — match has started")
        await db.execute(
            "DELETE FROM picks WHERE competitor_id = ? AND match_id = ?",
            [competitor_id, match_id]
        )
    return {"ok": True}


# ---------------------------------------------------------------------------
# Admin-side scoring config
# ---------------------------------------------------------------------------

class ScoringUpdate(BaseModel):
    result_points:         Optional[int] = None
    both_scores_points:    Optional[int] = None
    one_score_points:      Optional[int] = None
    first_scorer_points:   Optional[int] = None
    joker_multiplier:      Optional[int] = None
    pen_winner_bonus_goal: Optional[int] = None


# Imported in main.py and added to the admin router so it's gated by the secret
async def update_scoring_config(body: ScoringUpdate) -> dict:
    async with get_db() as db:
        sets: list[str] = []
        params: list = []
        for field in (
            "result_points", "both_scores_points", "one_score_points",
            "first_scorer_points", "joker_multiplier", "pen_winner_bonus_goal",
        ):
            v = getattr(body, field)
            if v is not None:
                sets.append(f"{field} = ?")
                params.append(int(v))
        if sets:
            await db.execute(
                f"UPDATE comp_scoring SET {', '.join(sets)} WHERE id = 1",
                params
            )
        config = await _scoring_config(db)
        # Re-score every finalised match so changes take effect immediately
        finals = await db.fetchall("SELECT id FROM matches WHERE status = 'final'")
        for r in finals:
            await recompute_match_points(db, r["id"])
    return config
