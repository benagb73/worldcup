"""
models/schemas.py
Pydantic response models for all API endpoints.
"""

from __future__ import annotations
from typing import Optional
from pydantic import BaseModel


# ---------------------------------------------------------------------------
# Core entities
# ---------------------------------------------------------------------------

class Team(BaseModel):
    id: int
    name: str
    code: str
    group_name: Optional[str]
    flag_url: Optional[str]
    world_rank: Optional[int] = None
    manager: Optional[str] = None


class Club(BaseModel):
    id: int
    name: str
    country: str        # 3-letter code (e.g. 'ENG', 'ESP')
    league: str


class Player(BaseModel):
    id: int
    team_id: int
    team_code: Optional[str] = None     # national team 3-letter code
    team_name: Optional[str] = None     # national team display name
    team_flag_url: Optional[str] = None
    name: str
    shirt_number: Optional[int]
    position: Optional[str]
    date_of_birth: Optional[str]
    club: Optional[Club]
    club_status: Optional[str] = None   # 'unattached' / 'unknown' / None
    # Live international totals: pre-tournament value + tournament contributions
    intl_caps: Optional[int] = None
    intl_goals: Optional[int] = None


class Venue(BaseModel):
    id: int
    name: str
    city: str
    country: str
    capacity: Optional[int]
    number_games: Optional[int] = None


# ---------------------------------------------------------------------------
# Standings
# ---------------------------------------------------------------------------

class StandingRow(BaseModel):
    team: Team
    played: int
    won: int
    drawn: int
    lost: int
    goals_for: int
    goals_against: int
    goal_diff: int
    points: int


class GroupStandings(BaseModel):
    group_name: str
    rows: list[StandingRow]


# ---------------------------------------------------------------------------
# Matches
# ---------------------------------------------------------------------------

class MatchScore(BaseModel):
    ht_home: Optional[int]
    ht_away: Optional[int]
    ft_home: Optional[int]
    ft_away: Optional[int]
    et_home: Optional[int]
    et_away: Optional[int]
    pen_home: Optional[int]
    pen_away: Optional[int]


class MatchSummary(BaseModel):
    id: int
    stage: str
    group_name: Optional[str]
    match_number: Optional[int]
    scheduled_at: str
    status: str
    home_team: Optional[Team]     # may be None on knockout placeholder rows
    away_team: Optional[Team]     # may be None on knockout placeholder rows
    score: MatchScore
    winner_id: Optional[int]
    venue: Optional[Venue]
    attendance: Optional[int] = None     # paid attendance once known


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

class MatchEvent(BaseModel):
    id: int
    event_type: str
    minute: int
    added_time: int
    period: str
    player_id: int
    player_name: str
    team_id: int
    team_code: str
    is_penalty: bool
    is_own_goal: bool
    related_event_id: Optional[int]
    # Populated for assists and substitution_on links
    related_player_name: Optional[str] = None


# ---------------------------------------------------------------------------
# Lineups
# ---------------------------------------------------------------------------

class LineupPlayer(BaseModel):
    player: Player
    is_starter: bool
    position_played: Optional[str]
    shirt_number: Optional[int]
    # Derived from events
    subbed_off_minute: Optional[int] = None
    subbed_on_minute: Optional[int] = None


class MatchLineup(BaseModel):
    team: Team
    starters: list[LineupPlayer]
    substitutes: list[LineupPlayer]


# ---------------------------------------------------------------------------
# Player stats
# ---------------------------------------------------------------------------

class PlayerMatchStats(BaseModel):
    player: Player
    team: Team
    is_starter: bool
    minutes_played: int
    goals: int
    assists: int
    shots_total: int
    shots_on_target: int
    penalties_taken: int
    penalties_scored: int
    passes_completed: int
    passes_attempted: int
    tackles_made: int
    interceptions: int
    clearances: int
    fouls_committed: int = 0
    fouls_won: int = 0
    yellow_cards: int
    red_cards: int
    saves: int
    goals_conceded: int
    penalty_saves: int


# ---------------------------------------------------------------------------
# Full match detail (used by the match page)
# ---------------------------------------------------------------------------

class TeamMatchStats(BaseModel):
    """Per-team aggregate for a single match — summed from
    player_match_stats rows for the team. Goals come from match events
    (so own goals credit the correct side, not the player's stats row)."""
    team_id: int
    goals: int
    yellow_cards: int
    red_cards: int
    passes_attempted: int
    passes_completed: int
    pass_accuracy: Optional[int]      # 0..100, None if no passes recorded yet
    shots_total: int
    shots_on_target: int
    fouls_committed: int
    fouls_won: int


class MatchDetail(BaseModel):
    match: MatchSummary
    lineups: list[MatchLineup]        # [home, away]
    events: list[MatchEvent]
    stats: list[PlayerMatchStats]
    team_stats: list[TeamMatchStats] = []   # [home, away] when both teams are set


# ---------------------------------------------------------------------------
# Bracket
# ---------------------------------------------------------------------------

class BracketSlot(BaseModel):
    slot: int
    stage: str
    home_team: Optional[Team]
    away_team: Optional[Team]
    home_seed_desc: Optional[str]
    away_seed_desc: Optional[str]
    match: Optional[MatchSummary]
    # "As it stands" projection — populated when home_team/away_team is still
    # NULL but we can guess from current group standings (winner / runner-up
    # of an in-progress group, or top-8 best 3rd-placed team mapped to a slot
    # constrained to specific groups). Rendered in italics on the frontend.
    home_team_provisional: Optional[Team] = None
    away_team_provisional: Optional[Team] = None


# ---------------------------------------------------------------------------
# Team detail
# ---------------------------------------------------------------------------

class PlayerTournamentTotals(BaseModel):
    player: Player
    apps: int                  # matches with a stats row (i.e. dressed for the match)
    minutes_played: int
    goals: int
    assists: int
    shots_total: int
    shots_on_target: int
    passes_completed: int = 0
    passes_attempted: int = 0
    tackles_made: int = 0
    fouls_committed: int = 0
    fouls_won: int = 0
    yellow_cards: int
    red_cards: int
    saves: int
    goals_conceded: int        # mostly for GK


class TeamTournamentTotals(BaseModel):
    """Aggregated team-level stats across every played match.
    Goals/conceded come from match results; the rest is summed from
    player_match_stats rows belonging to the team."""
    matches_played: int
    goals_for: int
    goals_against: int
    yellow_cards: int
    red_cards: int
    passes_attempted: int
    passes_completed: int
    pass_accuracy: Optional[int]
    shots_total: int
    shots_on_target: int
    fouls_committed: int
    fouls_won: int
    attendance_total: int = 0
    attendance_avg: Optional[int] = None     # avg over matches with a recorded attendance
    capacity_total: int = 0                  # sum of venue capacities for those matches
    capacity_avg: Optional[int] = None
    fill_percent: Optional[int] = None       # avg % full across those matches


class TeamDetail(BaseModel):
    team: Team
    standing: Optional[StandingRow]   # None for knockout-only teams
    fixtures: list[MatchSummary]
    squad: list[PlayerTournamentTotals]
    totals: Optional[TeamTournamentTotals] = None


# ---------------------------------------------------------------------------
# Leaderboard — one aggregated row per player across the tournament
# ---------------------------------------------------------------------------

class LeaderboardRow(BaseModel):
    player_id: int
    player_name: str
    shirt_number: Optional[int]
    position: Optional[str]
    team_id: int
    team_name: str
    team_code: str
    flag_url: Optional[str]
    apps: int
    minutes_played: int
    goals: int
    assists: int
    shots_total: int
    shots_on_target: int
    passes_completed: int
    passes_attempted: int
    tackles_made: int
    fouls_committed: int
    fouls_won: int
    yellow_cards: int
    red_cards: int
    saves: int
    goals_conceded: int



# ---------------------------------------------------------------------------
# Team leaderboard Ã¢ÂÂ one row per team, used on /leaderboard "Teams" tab
# ---------------------------------------------------------------------------

class TeamLeaderboardRow(BaseModel):
    team_id: int
    team_name: str
    team_code: str
    flag_url: Optional[str]
    matches_played: int
    goals_for: int
    goals_against: int
    yellow_cards: int
    red_cards: int
    passes_attempted: int
    passes_completed: int
    pass_accuracy: Optional[int]
    shots_total: int
    shots_on_target: int
    fouls_committed: int
    fouls_won: int
    attendance_total: int
    attendance_avg: Optional[int]
    capacity_total: int
    fill_percent: Optional[int]


class AttendanceSummary(BaseModel):
    """Tournament-wide attendance/% full headline for /leaderboard."""
    matches_with_attendance: int
    attendance_total: int
    attendance_avg: Optional[int]
    capacity_total: int
    fill_percent: Optional[int]
