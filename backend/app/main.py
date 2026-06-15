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
    )


MATCH_SELECT = """
    SELECT
        m.id, m.stage, m.group_name, m.match_number, m.scheduled_at,
        m.status, m.winner_id,
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

    groups: dict[str, list] = {}
    for row in rows:
        g = row["group_name"]
        groups.setdefault(g, []).append(
            StandingRow(
                team=_team(row),
                played=row["played"], won=row["won"], drawn=row["drawn"],
                lost=row["lost"], goals_for=row["goals_for"],
                goals_against=row["goals_against"], goal_diff=row["goal_diff"],
                points=row["points"],
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

    return TeamDetail(team=team, standing=standing, fixtures=fixtures, squad=squad)


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

    return MatchDetail(match=match, lineups=lineups, events=events, stats=stats)


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

    result = []
    for r in rows:
        match = None
        if r.get("match_id"):
            async with get_db() as db:
                mrow = await db.fetchone(
                    f"{MATCH_SELECT} WHERE m.id = ?", [r["match_id"]]
                )
            if mrow:
                match = await _build_match_summary(mrow)

        result.append(BracketSlot(
            slot=r["slot"], stage=r["stage"],
            home_team=Team(id=r["htid"], name=r["htname"], code=r["htcode"],
                           group_name=r.get("htgroup"), flag_url=r.get("htflag"),
                           world_rank=r.get("htrank"))
            if r.get("htid") else None,
            away_team=Team(id=r["atid"], name=r["atname"], code=r["atcode"],
                           group_name=r.get("atgroup"), flag_url=r.get("atflag"),
                           world_rank=r.get("atrank"))
            if r.get("atid") else None,
            home_seed_desc=r.get("home_seed_desc"),
            away_seed_desc=r.get("away_seed_desc"),
            match=match,
        ))
    return result


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
