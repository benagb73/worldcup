export interface Team {
  id: number
  name: string
  code: string
  group_name: string | null
  flag_url: string | null
  world_rank: number | null
  manager?: string | null
}

export interface Club {
  id: number
  name: string
  country: string         // 3-letter code (e.g. 'ENG', 'ESP')
  league: string
}

export interface Player {
  id: number
  team_id: number
  team_code?: string | null      // national team 3-letter code
  team_name?: string | null
  team_flag_url?: string | null
  name: string
  shirt_number: number | null
  position: 'GK' | 'DEF' | 'MID' | 'FWD' | null
  date_of_birth: string | null
  club: Club | null
  club_status: 'unattached' | 'unknown' | null
  intl_caps?: number | null
  intl_goals?: number | null
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
  home_team: Team | null      // null on knockout placeholder rows
  away_team: Team | null
  score: MatchScore
  winner_id: number | null
  venue: { id: number; name: string; city: string; country: string; capacity: number | null; number_games: number | null } | null
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
  fouls_committed: number
  fouls_won: number
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

export interface PlayerTournamentTotals {
  player: Player
  apps: number
  minutes_played: number
  goals: number
  assists: number
  shots_total: number
  shots_on_target: number
  passes_completed: number
  passes_attempted: number
  tackles_made: number
  fouls_committed: number
  fouls_won: number
  yellow_cards: number
  red_cards: number
  saves: number
  goals_conceded: number
}

export interface LeaderboardRow {
  player_id: number
  player_name: string
  shirt_number: number | null
  position: 'GK' | 'DEF' | 'MID' | 'FWD' | null
  team_id: number
  team_name: string
  team_code: string
  flag_url: string | null
  apps: number
  minutes_played: number
  goals: number
  assists: number
  shots_total: number
  shots_on_target: number
  passes_completed: number
  passes_attempted: number
  tackles_made: number
  fouls_committed: number
  fouls_won: number
  yellow_cards: number
  red_cards: number
  saves: number
  goals_conceded: number
}

export interface TeamDetail {
  team: Team
  standing: StandingRow | null
  fixtures: MatchSummary[]
  squad: PlayerTournamentTotals[]
}

// ---------------------------------------------------------------------------
// Competition (family prediction game)
// ---------------------------------------------------------------------------

export interface ScoringConfig {
  result_points: number
  both_scores_points: number
  one_score_points: number
  first_scorer_points: number
  joker_multiplier: number
  pen_winner_bonus_goal: number
  tournament_started: boolean
}

export interface Pool {
  id: number
  slug: string
  name: string
  created_at: string
  member_count: number
}

export interface PoolDetail {
  id: number
  slug: string
  name: string
  created_at: string
  members: CompetitorRow[]
}

export interface PoolMembership {
  id: number
  slug: string
  name: string
  joined_at: string
}

export interface CompetitorRow {
  id: number
  name: string
  team_name: string
  created_at: string
  picks_made: number
  total_points: number
  jokers_played: number
  matches_scored: number
}

export interface CompetitorDetail {
  id: number
  name: string
  team_name: string
  created_at: string
  total_points: number
  picks_made: number
  jokers_used: Record<string, number>
  joker_caps:  Record<string, number>
}

export interface PickRow {
  match_id: number
  stage: string
  group_name: string | null
  match_number: number | null
  scheduled_at: string
  status: string
  ft_home: number | null
  ft_away: number | null
  et_home: number | null
  et_away: number | null
  pen_home: number | null
  pen_away: number | null
  winner_id: number | null
  home_id: number | null
  home_name: string | null
  home_code: string | null
  home_flag: string | null
  away_id: number | null
  away_name: string | null
  away_code: string | null
  away_flag: string | null
  pick_id: number | null
  pick_home: number | null
  pick_away: number | null
  first_scorer_player_id: number | null
  first_scorer_name: string | null
  no_goal: number | null
  is_joker: number | null
  points_awarded: number | null
  joker_bucket: string
  pick_hidden: boolean
}

export interface MatchPickRow {
  competitor_id: number
  competitor_name: string
  team_name: string
  home_score: number
  away_score: number
  first_scorer_player_id: number | null
  first_scorer_name: string | null
  no_goal: number
  is_joker: number
  points_awarded: number | null
}

export interface MatchPicksResponse {
  match: {
    id: number
    status: string
    stage: string
    group_name: string | null
    scheduled_at: string
    ft_home: number | null
    ft_away: number | null
    et_home: number | null
    et_away: number | null
    pen_home: number | null
    pen_away: number | null
  }
  picks: MatchPickRow[]
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
