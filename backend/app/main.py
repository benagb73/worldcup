"""
app/main.py
FastAPI application — all routes.
"""

import os
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, HTTPException, Header, Query
from fastapi.middleware.cors import CORSMiddleware

from app.db.connection import get_db, init_db
from app.models.schemas import (
    AttendanceSummary,
    BracketSlot,
    GroupStandings,
    MatchDetail,
    MatchEvent,
    MatchLineup,
    MatchSummary,
    Player,
    PlayerMatchStats,
    PlayerTournamentTotals,
    StandingRow,
    Team,
    TeamDetail,
    TeamLeaderboardRow,
    TeamMatchStats,
    TeamTournamentTotals,
    Club,
    Venue,
    MatchScore,
    LineupPlayer,
    LeaderboardRow,
)

SYNC_SECRET = os.getenv("SYNC_SECRET", "dev-secret")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="World Cup API", version="1.0.0", lifespan=lifespan)

# Comma-separated list of allowed origins. In production, set this to your
# Vercel domain (e.g. "https://worldcup.vercel.app,https://worldcup-yourname.vercel.app").
# Empty / unset = wildcard (fine for local dev only).
_origins_env = os.getenv("ALLOWED_ORIGINS", "").strip()
_allowed_origins = (
    [o.strip() for o in _origins_env.split(",") if o.strip()]
    if _origins_env else ["*"]
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Tiny middleware: tag GET responses on public read-only endpoints with a short
# Cache-Control so browsers / Vercel's edge can serve repeat hits without
# round-tripping to the backend. SWR's 60s polling refreshes data anyway.
@app.middleware("http")
async def add_cache_headers(request, call_next):
    response = await call_next(request)
    if request.method != "GET":
        return response
    path = request.url.path
    # Only cache the high-traffic, idempotent read endpoints
    cacheable_prefixes = (
        "/api/groups", "/api/matches", "/api/teams", "/api/players",
        "/api/bracket", "/api/leaderboard", "/api/rosters",
    )
    # Don't cache admin or compete (per-user) or pick details
    if path.startswith("/api/admin") or path.startswith("/api/compete"):
        return response
    if any(path.startswith(p) for p in cacheable_prefixes):
        # 30s fresh, then 60s stale-while-revalidate so users still see
        # cached UI while a fresh fetch happens in the background.
        response.headers["Cache-Control"] = "public, max-age=30, stale-while-revalidate=60"
    return response

# Hidden admin router — gated by X-Admin-Secret header inside the module
from app.api.admin import router as admin_router  # noqa: E402
app.include_router(admin_router)

# Public competition router (family prediction game)
from app.api.compete import router as compete_router  # noqa: E402
app.include_router(compete_router)

# Admin-only scoring-config update lives on the secured admin router
from app.api.compete import update_scoring_config, ScoringUpdate  # noqa: E402

@admin_router.put("/scoring")
async def admin_update_scoring(body: ScoringUpdate):
    return await update_scoring_config(body)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _team(row: dict) -> Team:
    return Team(
        id=row["team_id"],
        name=row["team_name"],
        code=row["team_code"],
        group_name=row.get("team_group"),
        flag_url=row.get("flag_url"),
        world_rank=row.get("team_rank"),
    )


def _score(row: dict) -> MatchScore:
    return MatchScore(
        ht_home=row.get("ht_home"),
        ht_away=row.get("ht_away"),
        ft_home=row.get("ft_home"),
        ft_away=row.get("ft_away"),
        et_home=row.get("et_home"),
        et_away=row.get("et_away"),
        pen_home=row.get("pen_home"),
        pen_away=row.get("pen_away"),
    )


async def _build_match_summary(row: dict) -> MatchSummary:
    # Knockout placeholder rows may have NULL teams until winners are determined
    home_team = None
    if row.get("home_id"):
        home_team = Team(
            id=row["home_id"], name=row["home_name"], code=row["home_code"],
            group_name=row.get("home_group"), flag_url=row.get("home_flag"),
            world_rank=row.get("home_rank"),
        )
    away_team = None
    if row.get("away_id"):
        away_team = Team(
            id=row["away_id"], name=row["away_name"], code=row["away_code"],
            group_name=row.get("away_group"), flag_url=row.get("away_flag"),
            world_rank=row.get("away_rank"),
        )
    return MatchSummary(
        id=row["id"],
        stage=row["stage"],
        group_name=row.get("group_name"),
        match_number=row.get("match_number"),
        scheduled_at=row["scheduled_at"],
        status=row["status"],
        home_team=home_team,
        away_team=away_team,
        score=MatchScore(
            ht_home=row.get("ht_home"), ht_away=row.get("ht_away"),
            ft_home=row.get("ft_home"), ft_away=row.get("ft_away"),
            et_home=row.get("et_home"), et_away=row.get("et_away"),
            pen_home=row.get("pen_home"), pen_away=row.get("pen_away"),
        ),
        winner_id=row.get("winner_id"),
        venue=Venue(
            id=row["venue_id"], name=row["venue_name"],
            city=row["venue_city"], country=row["venue_country"],
            capacity=row.get("venue_capacity"),
            number_games=row.get("venue_games"),
        ) if row.get("venue_id") else None,
        attendance=row.get("attendance"),
    )


MATCH_SELECT = """
    SELECT
        m.id, m.stage, m.group_name, m.match_number, m.scheduled_at,
        m.status, m.winner_id, m.attendance,
        m.ht_home, m.ht_away, m.ft_home, m.ft_away,
        m.et_home, m.et_away, m.pen_home, m.pen_away,
        ht.id   AS home_id,   ht.name AS home_name,
        ht.code AS home_code, ht.group_name AS home_group,
        ht.flag_url AS home_flag, ht.world_rank AS home_rank,
        at.id   AS away_id,   at.name AS away_name,
        at.code AS away_code, at.group_name AS away_group,
        at.flag_url AS away_flag, at.world_rank AS away_rank,
        v.id    AS venue_id,  v.name AS venue_name,
        v.city  AS venue_city, v.country AS venue_country,
        v.capacity AS venue_capacity, v.number_games AS venue_games
    FROM matches m
    LEFT JOIN teams  ht ON m.home_team_id = ht.id
    LEFT JOIN teams  at ON m.away_team_id = at.id
    LEFT JOIN venues v  ON m.venue_id     = v.id
"""


# ---------------------------------------------------------------------------
# Groups & standings
# ---------------------------------------------------------------------------

@app.get("/api/groups", response_model=list[GroupStandings])
async def get_groups():
    """All group standings ordered by points → GD → GF."""
    async with get_db() as db:
        rows = await db.fetchall("""
            SELECT gs.group_name, gs.played, gs.won, gs.drawn, gs.lost,
                   gs.goals_for, gs.goals_against, gs.goal_diff, gs.points,
                   t.id AS team_id, t.name AS team_name, t.code AS team_code,
                   t.group_name AS team_group, t.flag_url, t.world_rank AS team_rank
            FROM group_standings gs
            JOIN teams t ON gs.team_id = t.id
            ORDER BY gs.group_name, gs.points DESC, gs.goal_diff DESC, gs.goals_for DESC
        """)
        # Source of truth for "did this team qualify to KO": the r32 bracket
        # itself. Covers admin manual corrections to 3rd-place qualifiers.
        ko_rows = await db.fetchall("""
            SELECT home_team_id, away_team_id FROM bracket WHERE stage = 'r32'
        """)

    qualified_ids: set[int] = set()
    for r in ko_rows:
        if r.get("home_team_id"): qualified_ids.add(r["home_team_id"])
        if r.get("away_team_id"): qualified_ids.add(r["away_team_id"])

    groups: dict[str, list] = {}
    for row in rows:
        g = row["group_name"]
        # Position within the group based on insertion order (already sorted
        # by the SELECT). Top 2 always qualify; 3rd qualifies iff their team
        # is in the r32 bracket.
        existing = groups.setdefault(g, [])
        rank = len(existing) + 1
        is_qualified = rank <= 2 or row["team_id"] in qualified_ids
        existing.append(
            StandingRow(
                team=_team(row),
                played=row["played"], won=row["won"], drawn=row["drawn"],
                lost=row["lost"], goals_for=row["goals_for"],
                goals_against=row["goals_against"], goal_diff=row["goal_diff"],
                points=row["points"],
                qualified_to_ko=is_qualified,
            )
        )

    return [GroupStandings(group_name=g, rows=r) for g, r in sorted(groups.items())]


# ---------------------------------------------------------------------------
# Team detail (roster + tournament totals + fixtures + standing)
# ---------------------------------------------------------------------------

@app.get("/api/rosters")
async def get_all_rosters():
    """Map of team_id → list of players. One round-trip for the whole
    family-pool pick page so we don't fire one fetch per team.
    """
    async with get_db() as db:
        rows = await db.fetchall("""
            SELECT team_id, id, name, shirt_number, position
            FROM players
            ORDER BY team_id,
              CASE position
                WHEN 'GK' THEN 0 WHEN 'DEF' THEN 1
                WHEN 'MID' THEN 2 WHEN 'FWD' THEN 3 ELSE 4
              END,
              COALESCE(shirt_number, 99), name
        """)
    out: dict[str, list] = {}
    for r in rows:
        out.setdefault(str(r["team_id"]), []).append({
            "id":           r["id"],
            "name":         r["name"],
            "shirt_number": r["shirt_number"],
            "position":     r["position"],
        })
    return out


@app.get("/api/teams/{team_id}/roster")
async def get_team_roster(team_id: int):
    """Lightweight public roster — used by the family-competition pick form."""
    async with get_db() as db:
        rows = await db.fetchall("""
            SELECT id, name, shirt_number, position
            FROM players WHERE team_id = ?
            ORDER BY
              CASE position
                WHEN 'GK' THEN 0 WHEN 'DEF' THEN 1
                WHEN 'MID' THEN 2 WHEN 'FWD' THEN 3 ELSE 4
              END,
              COALESCE(shirt_number, 99), name
        """, [team_id])
    return rows


@app.get("/api/teams/{team_id}", response_model=TeamDetail)
async def get_team(team_id: int):
    async with get_db() as db:
        team_row = await db.fetchone(
            "SELECT id, name, code, group_name, flag_url, world_rank, manager "
            "FROM teams WHERE id = ?",
            [team_id]
        )
        if not team_row:
            raise HTTPException(404, "Team not found")
        team = Team(
            id=team_row["id"], name=team_row["name"], code=team_row["code"],
            group_name=team_row.get("group_name"), flag_url=team_row.get("flag_url"),
            world_rank=team_row.get("world_rank"),
            manager=team_row.get("manager"),
        )

        # Group standing — None for knockout-only teams (no group_name)
        standing: Optional[StandingRow] = None
        if team.group_name:
            st = await db.fetchone("""
                SELECT played, won, drawn, lost, goals_for, goals_against,
                       goal_diff, points
                FROM group_standings WHERE team_id = ? AND group_name = ?
            """, [team_id, team.group_name])
            if st:
                standing = StandingRow(
                    team=team,
                    played=st["played"], won=st["won"], drawn=st["drawn"], lost=st["lost"],
                    goals_for=st["goals_for"], goals_against=st["goals_against"],
                    goal_diff=st["goal_diff"], points=st["points"],
                )

        # Fixtures involving this team (chronological)
        fx_rows = await db.fetchall(
            f"{MATCH_SELECT} WHERE m.home_team_id = ? OR m.away_team_id = ? "
            "ORDER BY m.scheduled_at",
            [team_id, team_id]
        )
        fixtures = [await _build_match_summary(r) for r in fx_rows]

        # Roster + aggregated tournament totals
        roster_rows = await db.fetchall("""
            SELECT p.id, p.name, p.shirt_number, p.position, p.date_of_birth, p.club_status,
                   p.intl_caps_pre, p.intl_goals_pre,
                   c.id AS cid, c.name AS cname, c.country AS ccountry, c.league AS cleague
            FROM players p
            LEFT JOIN clubs c ON p.club_id = c.id
            WHERE p.team_id = ?
            ORDER BY
                CASE p.position
                    WHEN 'GK' THEN 0 WHEN 'DEF' THEN 1
                    WHEN 'MID' THEN 2 WHEN 'FWD' THEN 3 ELSE 4
                END,
                COALESCE(p.shirt_number, 99), p.name
        """, [team_id])

        # Pull aggregate stats in one query keyed by player_id
        stat_rows = await db.fetchall("""
            SELECT player_id,
                   -- An appearance = the player actually got on the pitch
                   -- (starter or sub-on). Players who sat the whole match
                   -- on the bench don't count.
                   SUM(CASE WHEN minutes_played > 0 THEN 1 ELSE 0 END) AS apps,
                   COALESCE(SUM(minutes_played), 0)    AS minutes_played,
                   COALESCE(SUM(goals), 0)             AS goals,
                   COALESCE(SUM(assists), 0)           AS assists,
                   COALESCE(SUM(shots_total), 0)       AS shots_total,
                   COALESCE(SUM(shots_on_target), 0)   AS shots_on_target,
                   COALESCE(SUM(passes_completed), 0)  AS passes_completed,
                   COALESCE(SUM(passes_attempted), 0)  AS passes_attempted,
                   COALESCE(SUM(tackles_made), 0)      AS tackles_made,
                   COALESCE(SUM(fouls_committed), 0)   AS fouls_committed,
                   COALESCE(SUM(fouls_won), 0)         AS fouls_won,
                   COALESCE(SUM(yellow_cards), 0)      AS yellow_cards,
                   COALESCE(SUM(red_cards), 0)         AS red_cards,
                   COALESCE(SUM(saves), 0)             AS saves,
                   COALESCE(SUM(goals_conceded), 0)    AS goals_conceded
            FROM player_match_stats
            WHERE team_id = ?
            GROUP BY player_id
        """, [team_id])
        totals_by_pid = {r["player_id"]: r for r in stat_rows}

        squad: list[PlayerTournamentTotals] = []
        for pr in roster_rows:
            club = Club(id=pr["cid"], name=pr["cname"], country=pr["ccountry"],
                        league=pr["cleague"]) if pr.get("cid") else None
            # Live international totals = pre-tournament base + tournament contributions
            t = totals_by_pid.get(pr["id"], {})
            tour_apps  = sum(1 for s in stat_rows
                             if s["player_id"] == pr["id"] and (s["minutes_played"] or 0) > 0)
            player = Player(
                id=pr["id"], team_id=team_id, name=pr["name"],
                shirt_number=pr.get("shirt_number"),
                position=pr.get("position"),
                date_of_birth=pr.get("date_of_birth"),
                club=club,
                club_status=pr.get("club_status"),
                intl_caps  = (pr.get("intl_caps_pre")  or 0) + tour_apps,
                intl_goals = (pr.get("intl_goals_pre") or 0) + (t.get("goals", 0) or 0),
            )
            t = totals_by_pid.get(pr["id"], {})
            squad.append(PlayerTournamentTotals(
                player=player,
                apps=t.get("apps", 0),
                minutes_played=t.get("minutes_played", 0),
                goals=t.get("goals", 0),
                assists=t.get("assists", 0),
                shots_total=t.get("shots_total", 0),
                shots_on_target=t.get("shots_on_target", 0),
                passes_completed=t.get("passes_completed", 0),
                passes_attempted=t.get("passes_attempted", 0),
                tackles_made=t.get("tackles_made", 0),
                fouls_committed=t.get("fouls_committed", 0),
                fouls_won=t.get("fouls_won", 0),
                yellow_cards=t.get("yellow_cards", 0),
                red_cards=t.get("red_cards", 0),
                saves=t.get("saves", 0),
                goals_conceded=t.get("goals_conceded", 0),
            ))

        # ---- Team-wide aggregate totals across played matches ---------
        totals = await _build_team_totals(db, team_id)

    return TeamDetail(team=team, standing=standing, fixtures=fixtures,
                      squad=squad, totals=totals)


async def _build_team_totals(db, team_id: int) -> Optional[TeamTournamentTotals]:
    """Sum the team's player_match_stats rows + goals from match events +
    attendance/capacity from played matches. Returns None if the team hasn't
    played any finished matches yet."""
    agg = await db.fetchone("""
        SELECT
            COALESCE(SUM(passes_attempted), 0) AS pa,
            COALESCE(SUM(passes_completed), 0) AS pc,
            COALESCE(SUM(yellow_cards), 0)     AS yc,
            COALESCE(SUM(red_cards), 0)        AS rc,
            COALESCE(SUM(shots_total), 0)      AS sh,
            COALESCE(SUM(shots_on_target), 0)  AS sot,
            COALESCE(SUM(fouls_committed), 0)  AS fc,
            COALESCE(SUM(fouls_won), 0)        AS fw
        FROM player_match_stats
        WHERE team_id = ?
    """, [team_id])

    # Played matches = either side of a final match. Used for matches_played,
    # goals_for / against, and attendance/capacity averages.
    played = await db.fetchall("""
        SELECT m.id, m.home_team_id, m.away_team_id,
               m.ft_home, m.ft_away, m.et_home, m.et_away,
               m.attendance, v.capacity AS venue_capacity
        FROM matches m
        LEFT JOIN venues v ON m.venue_id = v.id
        WHERE m.status = 'final'
          AND (m.home_team_id = ? OR m.away_team_id = ?)
    """, [team_id, team_id])

    if not played and (agg["pa"] or 0) == 0:
        return None

    gf, ga = 0, 0
    att_total, cap_total, fill_matches = 0, 0, 0
    att_match_count = 0
    for m in played:
        h_eff = m["et_home"] if m["et_home"] is not None else (m["ft_home"] or 0)
        a_eff = m["et_away"] if m["et_away"] is not None else (m["ft_away"] or 0)
        if m["home_team_id"] == team_id:
            gf += h_eff; ga += a_eff
        else:
            gf += a_eff; ga += h_eff
        if m["attendance"] is not None:
            att_total += m["attendance"]
            att_match_count += 1
            if m["venue_capacity"]:
                cap_total += m["venue_capacity"]
                fill_matches += 1

    pa = agg["pa"] or 0
    pc = agg["pc"] or 0
    return TeamTournamentTotals(
        matches_played=len(played),
        goals_for=gf,
        goals_against=ga,
        yellow_cards=agg["yc"] or 0,
        red_cards=agg["rc"] or 0,
        passes_attempted=pa,
        passes_completed=pc,
        pass_accuracy=(round(pc / pa * 100) if pa > 0 else None),
        shots_total=agg["sh"] or 0,
        shots_on_target=agg["sot"] or 0,
        fouls_committed=agg["fc"] or 0,
        fouls_won=agg["fw"] or 0,
        attendance_total=att_total,
        attendance_avg=(round(att_total / att_match_count) if att_match_count else None),
        capacity_total=cap_total,
        capacity_avg=(round(cap_total / fill_matches) if fill_matches else None),
        fill_percent=(round(att_total / cap_total * 100) if cap_total else None),
    )


# ---------------------------------------------------------------------------
# Matches
# ---------------------------------------------------------------------------

@app.get("/api/matches", response_model=list[MatchSummary])
async def get_matches(
    stage: Optional[str] = Query(None),
    group: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
):
    where_clauses = []
    params = []
    if stage:
        where_clauses.append("m.stage = ?")
        params.append(stage)
    if group:
        where_clauses.append("m.group_name = ?")
        params.append(group)
    if status:
        where_clauses.append("m.status = ?")
        params.append(status)

    where = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
    sql = f"{MATCH_SELECT} {where} ORDER BY m.scheduled_at"

    async with get_db() as db:
        rows = await db.fetchall(sql, params)

    return [await _build_match_summary(r) for r in rows]


@app.get("/api/matches/{match_id}", response_model=MatchDetail)
async def get_match(match_id: int):
    async with get_db() as db:
        # Match summary
        row = await db.fetchone(f"{MATCH_SELECT} WHERE m.id = ?", [match_id])
        if not row:
            raise HTTPException(404, "Match not found")
        match = await _build_match_summary(row)

        # Events
        event_rows = await db.fetchall("""
            SELECT me.*, p.name AS player_name,
                   t.code AS team_code,
                   rp.name AS related_player_name
            FROM match_events me
            JOIN players p ON me.player_id = p.id
            JOIN teams   t ON me.team_id   = t.id
            LEFT JOIN match_events re ON me.related_event_id = re.id
            LEFT JOIN players rp ON re.player_id = rp.id
            WHERE me.match_id = ?
            ORDER BY me.period, me.minute, me.added_time, me.id
        """, [match_id])

        events = [
            MatchEvent(
                id=e["id"],
                event_type=e["event_type"],
                minute=e["minute"],
                added_time=e["added_time"] or 0,
                period=e["period"],
                player_id=e["player_id"],
                player_name=e["player_name"],
                team_id=e["team_id"],
                team_code=e["team_code"],
                is_penalty=bool(e["is_penalty"]),
                is_own_goal=bool(e["is_own_goal"]),
                related_event_id=e.get("related_event_id"),
                related_player_name=e.get("related_player_name"),
            )
            for e in event_rows
        ]

        # Sub minutes — build lookup from events
        sub_off: dict[int, int] = {}
        sub_on:  dict[int, int] = {}
        for e in event_rows:
            if e["event_type"] == "substitution_off":
                sub_off[e["player_id"]] = e["minute"]
            elif e["event_type"] == "substitution_on":
                sub_on[e["player_id"]] = e["minute"]

        # Lineups
        lineup_rows = await db.fetchall("""
            SELECT ml.is_starter, ml.position_played, ml.shirt_number,
                   ml.team_id,
                   p.id AS pid, p.name AS pname, p.position AS ppos,
                   p.shirt_number AS psquad_num, p.date_of_birth, p.club_status,
                   t.id AS tid, t.name AS tname, t.code AS tcode,
                   t.group_name AS tgroup, t.flag_url, t.world_rank,
                   c.id AS cid, c.name AS cname, c.country AS ccountry, c.league AS cleague
            FROM match_lineups ml
            JOIN players p ON ml.player_id = p.id
            JOIN teams   t ON ml.team_id   = t.id
            LEFT JOIN clubs c ON p.club_id = c.id
            WHERE ml.match_id = ?
            ORDER BY ml.team_id, ml.is_starter DESC, ml.shirt_number
        """, [match_id])

        # Group by team
        team_lineups: dict[int, dict] = {}
        for lr in lineup_rows:
            tid = lr["team_id"]
            if tid not in team_lineups:
                team_lineups[tid] = {
                    "team": Team(id=lr["tid"], name=lr["tname"], code=lr["tcode"],
                                 group_name=lr.get("tgroup"), flag_url=lr.get("flag_url"),
                                 world_rank=lr.get("world_rank")),
                    "starters": [],
                    "substitutes": [],
                }
            club = Club(id=lr["cid"], name=lr["cname"], country=lr["ccountry"],
                        league=lr["cleague"]) if lr.get("cid") else None
            player = Player(id=lr["pid"], team_id=tid, name=lr["pname"],
                            shirt_number=lr.get("psquad_num"),
                            position=lr.get("ppos"),
                            date_of_birth=lr.get("date_of_birth"), club=club,
                            club_status=lr.get("club_status"))
            lp = LineupPlayer(
                player=player,
                is_starter=bool(lr["is_starter"]),
                position_played=lr.get("position_played"),
                shirt_number=lr.get("shirt_number"),
                subbed_off_minute=sub_off.get(lr["pid"]),
                subbed_on_minute=sub_on.get(lr["pid"]),
            )
            key = "starters" if lr["is_starter"] else "substitutes"
            team_lineups[tid][key].append(lp)

        lineups = [MatchLineup(**v) for v in team_lineups.values()]

        # Player stats
        stat_rows = await db.fetchall("""
            SELECT pms.*,
                   p.name AS pname, p.position AS ppos, p.shirt_number AS psquad_num,
                   p.date_of_birth, p.club_status,
                   c.id AS cid, c.name AS cname, c.country AS ccountry, c.league AS cleague,
                   t.id AS tid, t.name AS tname, t.code AS tcode,
                   t.group_name AS tgroup, t.flag_url, t.world_rank
            FROM player_match_stats pms
            JOIN players p ON pms.player_id = p.id
            JOIN teams   t ON pms.team_id   = t.id
            LEFT JOIN clubs c ON p.club_id  = c.id
            WHERE pms.match_id = ?
        """, [match_id])

        stats = []
        for sr in stat_rows:
            club = Club(id=sr["cid"], name=sr["cname"], country=sr["ccountry"],
                        league=sr["cleague"]) if sr.get("cid") else None
            player = Player(id=sr["player_id"], team_id=sr["tid"], name=sr["pname"],
                            shirt_number=sr.get("psquad_num"), position=sr.get("ppos"),
                            date_of_birth=sr.get("date_of_birth"), club=club,
                            club_status=sr.get("club_status"))
            team = Team(id=sr["tid"], name=sr["tname"], code=sr["tcode"],
                        group_name=sr.get("tgroup"), flag_url=sr.get("flag_url"),
                        world_rank=sr.get("world_rank"))
            stats.append(PlayerMatchStats(
                player=player, team=team,
                is_starter=bool(sr["is_starter"]),
                minutes_played=sr["minutes_played"],
                goals=sr["goals"], assists=sr["assists"],
                shots_total=sr["shots_total"], shots_on_target=sr["shots_on_target"],
                penalties_taken=sr["penalties_taken"], penalties_scored=sr["penalties_scored"],
                passes_completed=sr["passes_completed"], passes_attempted=sr["passes_attempted"],
                tackles_made=sr["tackles_made"], interceptions=sr["interceptions"],
                clearances=sr["clearances"],
                fouls_committed=sr["fouls_committed"] or 0,
                fouls_won=sr["fouls_won"] or 0,
                yellow_cards=sr["yellow_cards"], red_cards=sr["red_cards"],
                saves=sr["saves"], goals_conceded=sr["goals_conceded"],
                penalty_saves=sr["penalty_saves"],
            ))

        # ---- Per-team aggregate stats ---------------------------------
        # Summed from player_match_stats for everything except goals; goals
        # come from match events so own goals credit the correct (opposing)
        # team — never the player's stats row.
        team_stats: list[TeamMatchStats] = []
        for side_id in (row.get("home_id"), row.get("away_id")):
            if side_id is None:
                continue
            side_stats = [s for s in stat_rows if s["team_id"] == side_id]
            pa  = sum(s["passes_attempted"] or 0 for s in side_stats)
            pc  = sum(s["passes_completed"] or 0 for s in side_stats)
            # Goals via events: own goals credit the opposite team. Shootout
            # kicks (period='penalties') are excluded — they decide the match
            # but don't add to either team's in-play goal tally.
            other_id = row["away_id"] if side_id == row.get("home_id") else row["home_id"]
            goals = sum(
                1 for e in event_rows
                if e["event_type"] == "goal"
                and e["period"] != "penalties"
                and (
                    (e["team_id"] == side_id and not e["is_own_goal"])
                    or (e["team_id"] == other_id and e["is_own_goal"])
                )
            )
            team_stats.append(TeamMatchStats(
                team_id=side_id,
                goals=goals,
                yellow_cards=sum(s["yellow_cards"] or 0 for s in side_stats),
                red_cards=sum(s["red_cards"] or 0 for s in side_stats),
                passes_attempted=pa,
                passes_completed=pc,
                pass_accuracy=(round(pc / pa * 100) if pa > 0 else None),
                shots_total=sum(s["shots_total"] or 0 for s in side_stats),
                shots_on_target=sum(s["shots_on_target"] or 0 for s in side_stats),
                fouls_committed=sum((s["fouls_committed"] or 0) for s in side_stats),
                fouls_won=sum((s["fouls_won"] or 0) for s in side_stats),
            ))

    return MatchDetail(match=match, lineups=lineups, events=events,
                       stats=stats, team_stats=team_stats)


# ---------------------------------------------------------------------------
# Players
# ---------------------------------------------------------------------------

@app.get("/api/players/{player_id}", response_model=Player)
async def get_player(player_id: int):
    async with get_db() as db:
        # Single combined query: player + national team + club + tournament aggregates
        row = await db.fetchone("""
            SELECT
              p.*,
              t.name AS tname, t.code AS tcode, t.flag_url AS tflag,
              c.id AS cid, c.name AS cname, c.country AS ccountry, c.league AS cleague,
              (SELECT COUNT(*) FROM player_match_stats pms
                 WHERE pms.player_id = p.id AND pms.minutes_played > 0) AS tour_apps,
              (SELECT COALESCE(SUM(goals), 0) FROM player_match_stats pms
                 WHERE pms.player_id = p.id) AS tour_goals
            FROM players p
            JOIN teams  t ON p.team_id = t.id
            LEFT JOIN clubs c ON p.club_id = c.id
            WHERE p.id = ?
        """, [player_id])
    if not row:
        raise HTTPException(404, "Player not found")
    club = Club(id=row["cid"], name=row["cname"], country=row["ccountry"],
                league=row["cleague"]) if row.get("cid") else None
    pre_caps  = row.get("intl_caps_pre")  or 0
    pre_goals = row.get("intl_goals_pre") or 0
    return Player(
        id=row["id"], team_id=row["team_id"],
        team_code=row.get("tcode"), team_name=row.get("tname"),
        team_flag_url=row.get("tflag"),
        name=row["name"],
        shirt_number=row.get("shirt_number"), position=row.get("position"),
        date_of_birth=row.get("date_of_birth"), club=club,
        club_status=row.get("club_status"),
        intl_caps  = pre_caps  + (row.get("tour_apps")  or 0),
        intl_goals = pre_goals + (row.get("tour_goals") or 0),
    )


@app.get("/api/players/{player_id}/stats", response_model=list[PlayerMatchStats])
async def get_player_stats(player_id: int):
    """All match stats for a player across the tournament."""
    async with get_db() as db:
        rows = await db.fetchall("""
            SELECT pms.*,
                   p.name AS pname, p.position AS ppos, p.shirt_number AS psquad_num,
                   p.date_of_birth, p.club_status,
                   c.id AS cid, c.name AS cname, c.country AS ccountry, c.league AS cleague,
                   t.id AS tid, t.name AS tname, t.code AS tcode,
                   t.group_name AS tgroup, t.flag_url, t.world_rank
            FROM player_match_stats pms
            JOIN players p ON pms.player_id = p.id
            JOIN teams   t ON pms.team_id   = t.id
            LEFT JOIN clubs c ON p.club_id  = c.id
            WHERE pms.player_id = ?
            ORDER BY pms.match_id
        """, [player_id])

    result = []
    for sr in rows:
        club = Club(id=sr["cid"], name=sr["cname"], country=sr["ccountry"],
                    league=sr["cleague"]) if sr.get("cid") else None
        player = Player(id=sr["player_id"], team_id=sr["tid"], name=sr["pname"],
                        shirt_number=sr.get("psquad_num"), position=sr.get("ppos"),
                        date_of_birth=sr.get("date_of_birth"), club=club,
                        club_status=sr.get("club_status"))
        team = Team(id=sr["tid"], name=sr["tname"], code=sr["tcode"],
                    group_name=sr.get("tgroup"), flag_url=sr.get("flag_url"),
                    world_rank=sr.get("world_rank"))
        result.append(PlayerMatchStats(
            player=player, team=team,
            is_starter=bool(sr["is_starter"]), minutes_played=sr["minutes_played"],
            goals=sr["goals"], assists=sr["assists"],
            shots_total=sr["shots_total"], shots_on_target=sr["shots_on_target"],
            penalties_taken=sr["penalties_taken"], penalties_scored=sr["penalties_scored"],
            passes_completed=sr["passes_completed"], passes_attempted=sr["passes_attempted"],
            tackles_made=sr["tackles_made"], interceptions=sr["interceptions"],
            clearances=sr["clearances"],
            fouls_committed=sr["fouls_committed"] or 0,
            fouls_won=sr["fouls_won"] or 0,
            yellow_cards=sr["yellow_cards"], red_cards=sr["red_cards"],
            saves=sr["saves"], goals_conceded=sr["goals_conceded"],
            penalty_saves=sr["penalty_saves"],
        ))
    return result


# ---------------------------------------------------------------------------
# Leaderboard — aggregated tournament stats for every player who has played
# ---------------------------------------------------------------------------

@app.get("/api/leaderboard", response_model=list[LeaderboardRow])
async def get_leaderboard():
    async with get_db() as db:
        rows = await db.fetchall("""
            SELECT
                p.id  AS player_id, p.name AS player_name, p.shirt_number, p.position,
                t.id  AS team_id, t.name AS team_name, t.code AS team_code, t.flag_url,
                -- Appearances = matches where the player actually got minutes
                -- (starter or sub-on), never benchwarmer rows.
                SUM(CASE WHEN pms.minutes_played > 0 THEN 1 ELSE 0 END) AS apps,
                COALESCE(SUM(pms.minutes_played), 0)  AS minutes_played,
                COALESCE(SUM(pms.goals), 0)           AS goals,
                COALESCE(SUM(pms.assists), 0)         AS assists,
                COALESCE(SUM(pms.shots_total), 0)     AS shots_total,
                COALESCE(SUM(pms.shots_on_target), 0) AS shots_on_target,
                COALESCE(SUM(pms.passes_completed), 0) AS passes_completed,
                COALESCE(SUM(pms.passes_attempted), 0) AS passes_attempted,
                COALESCE(SUM(pms.tackles_made), 0)    AS tackles_made,
                COALESCE(SUM(pms.fouls_committed), 0) AS fouls_committed,
                COALESCE(SUM(pms.fouls_won), 0)       AS fouls_won,
                COALESCE(SUM(pms.yellow_cards), 0)    AS yellow_cards,
                COALESCE(SUM(pms.red_cards), 0)       AS red_cards,
                COALESCE(SUM(pms.saves), 0)           AS saves,
                COALESCE(SUM(pms.goals_conceded), 0)  AS goals_conceded
            FROM player_match_stats pms
            JOIN players p ON pms.player_id = p.id
            JOIN teams   t ON pms.team_id   = t.id
            GROUP BY p.id
            HAVING SUM(pms.minutes_played) > 0
            ORDER BY minutes_played DESC, p.name
        """)
    return rows


# ---------------------------------------------------------------------------
# Team leaderboard — one row per team aggregated across played matches
# ---------------------------------------------------------------------------

@app.get("/api/team-leaderboard", response_model=list[TeamLeaderboardRow])
async def get_team_leaderboard():
    async with get_db() as db:
        teams = await db.fetchall(
            "SELECT id, name, code, flag_url FROM teams ORDER BY name"
        )
        out: list[TeamLeaderboardRow] = []
        for t in teams:
            totals = await _build_team_totals(db, t["id"])
            if totals is None or totals.matches_played == 0:
                continue
            out.append(TeamLeaderboardRow(
                team_id=t["id"], team_name=t["name"], team_code=t["code"],
                flag_url=t.get("flag_url"),
                matches_played=totals.matches_played,
                goals_for=totals.goals_for,
                goals_against=totals.goals_against,
                yellow_cards=totals.yellow_cards,
                red_cards=totals.red_cards,
                passes_attempted=totals.passes_attempted,
                passes_completed=totals.passes_completed,
                pass_accuracy=totals.pass_accuracy,
                shots_total=totals.shots_total,
                shots_on_target=totals.shots_on_target,
                fouls_committed=totals.fouls_committed,
                fouls_won=totals.fouls_won,
                attendance_total=totals.attendance_total,
                attendance_avg=totals.attendance_avg,
                capacity_total=totals.capacity_total,
                fill_percent=totals.fill_percent,
            ))
    return out


@app.get("/api/attendance-summary", response_model=AttendanceSummary)
async def get_attendance_summary():
    """Tournament-wide headline numbers for the /leaderboard hero strip."""
    async with get_db() as db:
        row = await db.fetchone("""
            SELECT
              COUNT(*)                              AS matches_with_attendance,
              COALESCE(SUM(m.attendance), 0)        AS attendance_total,
              COALESCE(SUM(v.capacity), 0)          AS capacity_total
            FROM matches m
            LEFT JOIN venues v ON m.venue_id = v.id
            WHERE m.attendance IS NOT NULL
        """)
    n   = row["matches_with_attendance"] or 0
    att = row["attendance_total"] or 0
    cap = row["capacity_total"] or 0
    return AttendanceSummary(
        matches_with_attendance=n,
        attendance_total=att,
        attendance_avg=(round(att / n) if n else None),
        capacity_total=cap,
        fill_percent=(round(att / cap * 100) if cap else None),
    )


# ---------------------------------------------------------------------------
# Bracket
# ---------------------------------------------------------------------------

@app.get("/api/bracket", response_model=list[BracketSlot])
async def get_bracket():
    async with get_db() as db:
        rows = await db.fetchall("""
            SELECT b.id, b.stage, b.slot, b.home_seed_desc, b.away_seed_desc,
                   b.match_id,
                   ht.id AS htid, ht.name AS htname, ht.code AS htcode,
                   ht.group_name AS htgroup, ht.flag_url AS htflag, ht.world_rank AS htrank,
                   at.id AS atid, at.name AS atname, at.code AS atcode,
                   at.group_name AS atgroup, at.flag_url AS atflag, at.world_rank AS atrank
            FROM bracket b
            LEFT JOIN teams ht ON b.home_team_id = ht.id
            LEFT JOIN teams at ON b.away_team_id = at.id
            ORDER BY b.stage, b.slot
        """)

        # ---- Provisional projection: current group standings + top-8 thirds.
        # Only computed once per request. Used to fill home_team_provisional /
        # away_team_provisional on slots that don't yet have a real team.
        rankings    = await _current_group_rankings(db)
        third_qual  = _top_third_qualifiers(rankings, n=8)
        third_slots = [r for r in rows
                       if (_parse_third_groups(r.get("home_seed_desc")) is not None)
                       or (_parse_third_groups(r.get("away_seed_desc")) is not None)]
        third_assign = _assign_thirds_to_slots(third_slots, third_qual)
        team_by_id   = await _teams_by_id(db)

        # Bulk-fetch every linked match summary in ONE query instead of
        # opening a new DB connection per row (which scales O(slots) and
        # got noticeably slow once the bracket linker ran and all 32 R32
        # slots gained a match_id).
        match_ids = [r["match_id"] for r in rows if r.get("match_id")]
        match_by_id: dict[int, dict] = {}
        if match_ids:
            placeholders = ",".join("?" * len(match_ids))
            mrows = await db.fetchall(
                f"{MATCH_SELECT} WHERE m.id IN ({placeholders})",
                match_ids,
            )
            match_by_id = {mr["id"]: mr for mr in mrows}

    result = []
    for r in rows:
        match = None
        mrow = match_by_id.get(r["match_id"]) if r.get("match_id") else None
        if mrow:
            match = await _build_match_summary(mrow)

        home_team = Team(id=r["htid"], name=r["htname"], code=r["htcode"],
                         group_name=r.get("htgroup"), flag_url=r.get("htflag"),
                         world_rank=r.get("htrank")) if r.get("htid") else None
        away_team = Team(id=r["atid"], name=r["atname"], code=r["atcode"],
                         group_name=r.get("atgroup"), flag_url=r.get("atflag"),
                         world_rank=r.get("atrank")) if r.get("atid") else None

        # Provisional projections (only when the actual slot is still empty)
        home_prov = None if home_team else _project_team(
            r.get("home_seed_desc"), rankings, third_assign.get((r["id"], "home")),
            team_by_id,
        )
        away_prov = None if away_team else _project_team(
            r.get("away_seed_desc"), rankings, third_assign.get((r["id"], "away")),
            team_by_id,
        )

        result.append(BracketSlot(
            slot=r["slot"], stage=r["stage"],
            home_team=home_team,
            away_team=away_team,
            home_seed_desc=r.get("home_seed_desc"),
            away_seed_desc=r.get("away_seed_desc"),
            match=match,
            home_team_provisional=home_prov,
            away_team_provisional=away_prov,
        ))
    return result


# ---------------------------------------------------------------------------
# Bracket projection helpers
# ---------------------------------------------------------------------------

import re as _re_main

# "Winner Group X" / "Winner X" / "Winners X"
_WINNER_RE     = _re_main.compile(r"^\s*winners?(?:\s+group)?\s+([A-Z])\s*$", _re_main.I)
# "Runner up Group X" / "Runner-up X" / "Runners-up X" / "2nd X" / "2nd Group X" / "2nd place X"
_RUNNERUP_RE   = _re_main.compile(
    r"^\s*(?:runners?[-\s]?up|2nd|second)(?:\s+place)?(?:\s+group)?\s+([A-Z])\s*$",
    _re_main.I,
)
# "3rd Group X/Y/Z" or "Best 3rd (X/Y/Z)" — return the allowed groups.
# Requires a "3rd"/"third"/"best 3rd" marker followed by a list of single
# letters separated by `/` or commas. We tolerate an optional "Group" /
# "Groups" word and parens between the marker and the letters.
_THIRD_GROUPS_RE = _re_main.compile(
    r"(?:3rd|third|best\s+3rd)\s*(?:place\s+)?(?:groups?\s+)?\(?\s*"
    r"([A-Z](?:\s*[/,]\s*[A-Z])+)",
    _re_main.I,
)


def _parse_winner_group(desc: Optional[str]) -> Optional[str]:
    if not desc:
        return None
    m = _WINNER_RE.match(desc)
    return m.group(1).upper() if m else None


def _parse_runnerup_group(desc: Optional[str]) -> Optional[str]:
    if not desc:
        return None
    m = _RUNNERUP_RE.match(desc)
    return m.group(1).upper() if m else None


def _parse_third_groups(desc: Optional[str]) -> Optional[set[str]]:
    """Return the allowed group letters for a 3rd-place slot (e.g.
    'A/B/C/D/F' → {A,B,C,D,F}), or None if the descriptor isn't a 3rd-place
    slot."""
    if not desc:
        return None
    m = _THIRD_GROUPS_RE.search(desc)
    if not m:
        return None
    return {g.strip().upper() for g in _re_main.split(r"[/,]", m.group(1)) if g.strip()}


async def _current_group_rankings(db) -> dict[str, list[dict]]:
    """For every group, return its standings rows ordered as they would
    appear publicly (points DESC, GD DESC, GF DESC, team_id ASC for stable
    tie-break)."""
    rows = await db.fetchall("""
        SELECT gs.group_name, gs.team_id, gs.points,
               gs.goal_diff, gs.goals_for
        FROM group_standings gs
        ORDER BY gs.group_name,
                 gs.points DESC, gs.goal_diff DESC, gs.goals_for DESC,
                 gs.team_id
    """)
    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(r["group_name"], []).append(r)
    return out


def _top_third_qualifiers(rankings: dict[str, list[dict]], n: int) -> list[dict]:
    """Return the top-N 3rd-placed teams across all groups, sorted by
    points → goal_diff → goals_for. Each dict has team_id, group_name,
    points, goal_diff, goals_for."""
    pool: list[dict] = []
    for group, rows in rankings.items():
        if len(rows) >= 3:
            third = rows[2]                          # 3rd-placed team
            pool.append({
                "group_name": group,
                "team_id":    third["team_id"],
                "points":     third["points"],
                "goal_diff":  third["goal_diff"],
                "goals_for":  third["goals_for"],
            })
    pool.sort(key=lambda r: (-r["points"], -r["goal_diff"], -r["goals_for"], r["team_id"]))
    return pool[:n]


def _assign_thirds_to_slots(
    third_slots: list[dict],
    qualifiers:  list[dict],
) -> dict[tuple[int, str], int]:
    """Bipartite-match the (up to 8) best 3rd-placed teams to the slots
    constrained by their seed_desc allowed-group set. Returns a mapping of
    (bracket_row_id, 'home' | 'away') → team_id for the slots we managed to
    fill. Uses depth-first backtracking — with at most 8 slots and 8 teams
    it's effectively instant.

    If a unique assignment isn't possible (e.g. mid-tournament when some
    groups haven't fielded a 3rd-placed team yet), we still return the
    best partial assignment — slots that couldn't be filled stay empty.
    """
    # Enumerate every 3rd-place "side" on a slot — usually each slot has one,
    # but in principle a bracket could be authored with two.
    sides: list[tuple[int, str, set[str]]] = []
    for slot in third_slots:
        for side in ("home", "away"):
            allowed = _parse_third_groups(slot.get(f"{side}_seed_desc"))
            if allowed:
                sides.append((slot["id"], side, allowed))

    if not sides or not qualifiers:
        return {}

    # Order sides by constraint tightness (fewest options first) so the
    # backtracker fails fast on the hardest slots before chewing through
    # easy ones.
    sides.sort(key=lambda s: (len(s[2]), s[0]))

    by_group: dict[str, dict] = {q["group_name"]: q for q in qualifiers}
    target = min(len(sides), len(qualifiers))   # best achievable size

    best: dict[str, object] = {"size": -1, "assign": {}}
    used_groups: set[str] = set()
    assignment: dict[tuple[int, str], int] = {}

    def backtrack(i: int) -> None:
        # Already found a full max assignment? Stop exploring.
        if best["size"] == target:
            return
        if i == len(sides):
            if len(assignment) > int(best["size"]):
                best["size"]   = len(assignment)
                best["assign"] = dict(assignment)
            return
        # Branch-and-bound: even if we fill every remaining slot we can't
        # beat the current best → prune.
        if len(assignment) + (len(sides) - i) <= int(best["size"]):
            return

        slot_id, side, allowed = sides[i]
        candidates = sorted(
            (g for g in allowed if g in by_group and g not in used_groups),
            key=lambda g: (-by_group[g]["points"],
                           -by_group[g]["goal_diff"],
                           -by_group[g]["goals_for"],
                           by_group[g]["team_id"]),
        )
        # Try every candidate, AND try skipping. We must explore both
        # branches at every level to find the true maximum-cardinality
        # assignment — a greedy "first candidate wins" approach can leave
        # a later, more-constrained slot unfillable when a different
        # choice here would have unblocked it.
        for grp in candidates:
            used_groups.add(grp)
            assignment[(slot_id, side)] = by_group[grp]["team_id"]
            backtrack(i + 1)
            used_groups.remove(grp)
            del assignment[(slot_id, side)]
            if best["size"] == target:
                return
        backtrack(i + 1)

    backtrack(0)
    return best["assign"]  # type: ignore[return-value]


async def _teams_by_id(db) -> dict[int, Team]:
    rows = await db.fetchall(
        "SELECT id, name, code, group_name, flag_url, world_rank FROM teams"
    )
    return {
        r["id"]: Team(
            id=r["id"], name=r["name"], code=r["code"],
            group_name=r.get("group_name"), flag_url=r.get("flag_url"),
            world_rank=r.get("world_rank"),
        ) for r in rows
    }


def _project_team(
    seed_desc:  Optional[str],
    rankings:   dict[str, list[dict]],
    third_team: Optional[int],
    team_by_id: dict[int, Team],
) -> Optional[Team]:
    """Best-guess team for an empty bracket slot, from current standings.
    Returns None if we can't project anything useful."""
    if not seed_desc:
        return None
    # Pre-computed 3rd-place assignment wins if present.
    if third_team is not None:
        return team_by_id.get(third_team)
    grp = _parse_winner_group(seed_desc)
    if grp and grp in rankings and rankings[grp]:
        return team_by_id.get(rankings[grp][0]["team_id"])
    grp = _parse_runnerup_group(seed_desc)
    if grp and grp in rankings and len(rankings[grp]) >= 2:
        return team_by_id.get(rankings[grp][1]["team_id"])
    return None


# ---------------------------------------------------------------------------
# Sync endpoint — triggered by cron or data provider webhook
# ---------------------------------------------------------------------------

@app.post("/api/sync")
async def trigger_sync(x_sync_secret: str = Header(...)):
    if x_sync_secret != SYNC_SECRET:
        raise HTTPException(403, "Invalid sync secret")
    from app.sync.sync_matches import run_sync
    await run_sync()
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok"}
