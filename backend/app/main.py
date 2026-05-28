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
    StandingRow,
    Team,
    Club,
    Venue,
    MatchScore,
    LineupPlayer,
)

SYNC_SECRET = os.getenv("SYNC_SECRET", "dev-secret")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield


app = FastAPI(title="World Cup API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],    # tighten in production
    allow_methods=["*"],
    allow_headers=["*"],
)


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
    return MatchSummary(
        id=row["id"],
        stage=row["stage"],
        group_name=row.get("group_name"),
        match_number=row.get("match_number"),
        scheduled_at=row["scheduled_at"],
        status=row["status"],
        home_team=Team(
            id=row["home_id"], name=row["home_name"], code=row["home_code"],
            group_name=row.get("home_group"), flag_url=row.get("home_flag"),
        ),
        away_team=Team(
            id=row["away_id"], name=row["away_name"], code=row["away_code"],
            group_name=row.get("away_group"), flag_url=row.get("away_flag"),
        ),
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
        ) if row.get("venue_id") else None,
    )


MATCH_SELECT = """
    SELECT
        m.id, m.stage, m.group_name, m.match_number, m.scheduled_at,
        m.status, m.winner_id,
        m.ht_home, m.ht_away, m.ft_home, m.ft_away,
        m.et_home, m.et_away, m.pen_home, m.pen_away,
        ht.id   AS home_id,   ht.name AS home_name,
        ht.code AS home_code, ht.group_name AS home_group, ht.flag_url AS home_flag,
        at.id   AS away_id,   at.name AS away_name,
        at.code AS away_code, at.group_name AS away_group, at.flag_url AS away_flag,
        v.id    AS venue_id,  v.name AS venue_name,
        v.city  AS venue_city, v.country AS venue_country, v.capacity AS venue_capacity
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
                   t.group_name AS team_group, t.flag_url
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
                   p.shirt_number AS psquad_num, p.date_of_birth,
                   t.id AS tid, t.name AS tname, t.code AS tcode,
                   t.group_name AS tgroup, t.flag_url,
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
                                 group_name=lr.get("tgroup"), flag_url=lr.get("flag_url")),
                    "starters": [],
                    "substitutes": [],
                }
            club = Club(id=lr["cid"], name=lr["cname"], country=lr["ccountry"],
                        league=lr["cleague"]) if lr.get("cid") else None
            player = Player(id=lr["pid"], team_id=tid, name=lr["pname"],
                            shirt_number=lr.get("psquad_num"),
                            position=lr.get("ppos"),
                            date_of_birth=lr.get("date_of_birth"), club=club)
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
                   p.date_of_birth,
                   c.id AS cid, c.name AS cname, c.country AS ccountry, c.league AS cleague,
                   t.id AS tid, t.name AS tname, t.code AS tcode,
                   t.group_name AS tgroup, t.flag_url
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
                            date_of_birth=sr.get("date_of_birth"), club=club)
            team = Team(id=sr["tid"], name=sr["tname"], code=sr["tcode"],
                        group_name=sr.get("tgroup"), flag_url=sr.get("flag_url"))
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
        row = await db.fetchone("""
            SELECT p.*, c.id AS cid, c.name AS cname, c.country AS ccountry, c.league AS cleague
            FROM players p
            LEFT JOIN clubs c ON p.club_id = c.id
            WHERE p.id = ?
        """, [player_id])
    if not row:
        raise HTTPException(404, "Player not found")
    club = Club(id=row["cid"], name=row["cname"], country=row["ccountry"],
                league=row["cleague"]) if row.get("cid") else None
    return Player(id=row["id"], team_id=row["team_id"], name=row["name"],
                  shirt_number=row.get("shirt_number"), position=row.get("position"),
                  date_of_birth=row.get("date_of_birth"), club=club)


@app.get("/api/players/{player_id}/stats", response_model=list[PlayerMatchStats])
async def get_player_stats(player_id: int):
    """All match stats for a player across the tournament."""
    async with get_db() as db:
        rows = await db.fetchall("""
            SELECT pms.*,
                   p.name AS pname, p.position AS ppos, p.shirt_number AS psquad_num,
                   p.date_of_birth,
                   c.id AS cid, c.name AS cname, c.country AS ccountry, c.league AS cleague,
                   t.id AS tid, t.name AS tname, t.code AS tcode,
                   t.group_name AS tgroup, t.flag_url
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
                        date_of_birth=sr.get("date_of_birth"), club=club)
        team = Team(id=sr["tid"], name=sr["tname"], code=sr["tcode"],
                    group_name=sr.get("tgroup"), flag_url=sr.get("flag_url"))
        result.append(PlayerMatchStats(
            player=player, team=team,
            is_starter=bool(sr["is_starter"]), minutes_played=sr["minutes_played"],
            goals=sr["goals"], assists=sr["assists"],
            shots_total=sr["shots_total"], shots_on_target=sr["shots_on_target"],
            penalties_taken=sr["penalties_taken"], penalties_scored=sr["penalties_scored"],
            passes_completed=sr["passes_completed"], passes_attempted=sr["passes_attempted"],
            tackles_made=sr["tackles_made"], interceptions=sr["interceptions"],
            clearances=sr["clearances"],
            yellow_cards=sr["yellow_cards"], red_cards=sr["red_cards"],
            saves=sr["saves"], goals_conceded=sr["goals_conceded"],
            penalty_saves=sr["penalty_saves"],
        ))
    return result


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
                   ht.group_name AS htgroup, ht.flag_url AS htflag,
                   at.id AS atid, at.name AS atname, at.code AS atcode,
                   at.group_name AS atgroup, at.flag_url AS atflag
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
                           group_name=r.get("htgroup"), flag_url=r.get("htflag"))
            if r.get("htid") else None,
            away_team=Team(id=r["atid"], name=r["atname"], code=r["atcode"],
                           group_name=r.get("atgroup"), flag_url=r.get("atflag"))
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
