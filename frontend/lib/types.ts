export interface Team {
  id: number
  name: string
  code: string
  group_name: string | null
  flag_url: string | null
}

export interface Club {
  id: number
  name: string
  country: string
  league: string
}

export interface Player {
  id: number
  team_id: number
  name: string
  shirt_number: number | null
  position: 'GK' | 'DEF' | 'MID' | 'FWD' | null
  date_of_birth: string | null
  club: Club | null
}

export interface MatchScore {
  ht_home: number | null
  ht_away: number | null
  ft_home: number | null
  ft_away: number | null
  et_home: number | null
  et_away: number | null
  pen_home: number | null
  pen_away: number | null
}

export interface MatchSummary {
  id: number
  stage: string
  group_name: string | null
  match_number: string | null
  scheduled_at: string
  status: string
  home_team: Team
  away_team: Team
  score: MatchScore
  winner_id: number | null
  venue: { id: number; name: string; city: string; country: string; capacity: number | null } | null
}

export interface MatchEvent {
  id: number
  event_type: string
  minute: number
  added_time: number
  period: string
  player_id: number
  player_name: string
  team_id: number
  team_code: string
  is_penalty: boolean
  is_own_goal: boolean
  related_event_id: number | null
  related_player_name: string | null
}

export interface LineupPlayer {
  player: Player
  is_starter: boolean
  position_played: string | null
  shirt_number: number | null
  subbed_off_minute: number | null
  subbed_on_minute: number | null
}

export interface MatchLineup {
  team: Team
  starters: LineupPlayer[]
  substitutes: LineupPlayer[]
}

export interface PlayerMatchStats {
  player: Player
  team: Team
  is_starter: boolean
  minutes_played: number
  goals: number
  assists: number
  shots_total: number
  shots_on_target: number
  penalties_taken: number
  penalties_scored: number
  passes_completed: number
  passes_attempted: number
  tackles_made: number
  interceptions: number
  clearances: number
  yellow_cards: number
  red_cards: number
  saves: number
  goals_conceded: number
  penalty_saves: number
}

export interface MatchDetail {
  match: MatchSummary
  lineups: MatchLineup[]
  events: MatchEvent[]
  stats: PlayerMatchStats[]
}

export interface StandingRow {
  team: Team
  played: number
  won: number
  drawn: number
  lost: number
  goals_for: number
  goals_against: number
  goal_diff: number
  points: number
}

export interface GroupStandings {
  group_name: string
  rows: StandingRow[]
}

export interface BracketSlot {
  slot: number
  stage: string
  home_team: Team | null
  away_team: Team | null
  home_seed_desc: string | null
  away_seed_desc: string | null
  match: MatchSummary | null
}
