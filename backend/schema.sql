-- ============================================================
-- WORLD CUP DATABASE SCHEMA
-- Compatible with SQLite (local dev) and Turso (production)
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- TEAMS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS teams (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  code        TEXT NOT NULL UNIQUE,   -- e.g. 'BRA', 'FRA'
  group_name  TEXT,                   -- 'A'..'L' (WC 2026 has 12 groups), NULL otherwise
  flag_url    TEXT,
  world_rank  INTEGER,                -- FIFA world ranking at time of seeding
  manager     TEXT,                   -- head coach name (synced from Wikipedia)
  created_at  TEXT DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- CLUBS (where players play their domestic football)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clubs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  country     TEXT NOT NULL,
  league      TEXT NOT NULL           -- e.g. 'Premier League', 'La Liga'
);

-- ------------------------------------------------------------
-- PLAYERS
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS players (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id       INTEGER NOT NULL REFERENCES teams(id),
  club_id       INTEGER REFERENCES clubs(id),
  name          TEXT NOT NULL,
  shirt_number  INTEGER,
  position      TEXT CHECK(position IN ('GK','DEF','MID','FWD')),
  date_of_birth TEXT,
  club_status   TEXT,                 -- 'unattached' / 'unknown' when club_id is NULL
  -- International caps + goals BEFORE the tournament (from Wikipedia sync).
  -- The API serves a live total: pre + tournament contributions.
  intl_caps_pre  INTEGER DEFAULT 0,
  intl_goals_pre INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- VENUES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS venues (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  city          TEXT NOT NULL,
  country       TEXT NOT NULL,
  capacity      INTEGER,
  number_games  INTEGER                -- how many WC matches are scheduled here
);

-- ------------------------------------------------------------
-- MATCHES
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS matches (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  stage           TEXT NOT NULL CHECK(stage IN (
                    'group','r32','r16','qf','sf','third_place','final'
                  )),
  group_name      TEXT,               -- 'A'..'H', NULL for knockout
  match_number    INTEGER,            -- official match number
  venue_id        INTEGER REFERENCES venues(id),
  home_team_id    INTEGER REFERENCES teams(id),
  away_team_id    INTEGER REFERENCES teams(id),
  scheduled_at    TEXT NOT NULL,      -- ISO8601 UTC

  -- Status
  status          TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN (
                    'scheduled','live','live_et','live_penalties','final','postponed'
                  )),

  -- Scores — layered so display logic is unambiguous
  ht_home         INTEGER,            -- half-time
  ht_away         INTEGER,
  ft_home         INTEGER,            -- full-time (90 min)
  ft_away         INTEGER,
  et_home         INTEGER,            -- after extra time (if played)
  et_away         INTEGER,
  pen_home        INTEGER,            -- penalty shootout score (if played)
  pen_away        INTEGER,

  winner_id       INTEGER REFERENCES teams(id),  -- NULL until decided
  attendance      INTEGER,            -- official paid attendance (admin-entered)
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- KNOCKOUT BRACKET SLOTS
-- Slots are pre-seeded at tournament start with NULLs; filled as teams advance
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bracket (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  stage         TEXT NOT NULL,        -- r16, qf, sf, third_place, final
  slot          INTEGER NOT NULL,     -- position in bracket (1-based per stage)
  home_team_id  INTEGER REFERENCES teams(id),
  away_team_id  INTEGER REFERENCES teams(id),
  match_id      INTEGER REFERENCES matches(id),
  -- Seeding source (e.g. "Winner Group A", "Runner-up Group B")
  home_seed_desc TEXT,
  away_seed_desc TEXT
);

-- ------------------------------------------------------------
-- GROUP STANDINGS (materialised view, updated after each match)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS group_standings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  group_name    TEXT NOT NULL,
  team_id       INTEGER NOT NULL REFERENCES teams(id),
  played        INTEGER DEFAULT 0,
  won           INTEGER DEFAULT 0,
  drawn         INTEGER DEFAULT 0,
  lost          INTEGER DEFAULT 0,
  goals_for     INTEGER DEFAULT 0,
  goals_against INTEGER DEFAULT 0,
  goal_diff     INTEGER GENERATED ALWAYS AS (goals_for - goals_against) VIRTUAL,
  points        INTEGER GENERATED ALWAYS AS (won * 3 + drawn) VIRTUAL,
  UNIQUE(group_name, team_id)
);

-- ------------------------------------------------------------
-- MATCH LINEUPS
-- One row per player per match (starter or sub)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS match_lineups (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id      INTEGER NOT NULL REFERENCES matches(id),
  team_id       INTEGER NOT NULL REFERENCES teams(id),
  player_id     INTEGER NOT NULL REFERENCES players(id),
  is_starter    INTEGER NOT NULL DEFAULT 0 CHECK(is_starter IN (0,1)),
  position_played TEXT,               -- position in THIS match (may differ from usual)
  shirt_number  INTEGER,              -- may differ from squad number
  UNIQUE(match_id, player_id)
);

-- ------------------------------------------------------------
-- MATCH EVENTS  (unified event log)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS match_events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id         INTEGER NOT NULL REFERENCES matches(id),
  team_id          INTEGER NOT NULL REFERENCES teams(id),
  player_id        INTEGER NOT NULL REFERENCES players(id),

  event_type       TEXT NOT NULL CHECK(event_type IN (
                     'goal',
                     'goal_penalty_miss',    -- penalty attempt that didn't score
                     'own_goal',
                     'assist',
                     'yellow_card',
                     'yellow_red_card',      -- 2nd yellow
                     'red_card',
                     'substitution_off',     -- player leaving
                     'substitution_on'       -- player coming on
                   )),

  minute           INTEGER NOT NULL,
  added_time       INTEGER DEFAULT 0,        -- stoppage-time minutes added
  period           TEXT NOT NULL DEFAULT 'normal' CHECK(period IN (
                     'normal','extra_time_1','extra_time_2','penalties'
                   )),

  -- Goal flags
  is_penalty       INTEGER DEFAULT 0 CHECK(is_penalty IN (0,1)),
  is_own_goal      INTEGER DEFAULT 0 CHECK(is_own_goal IN (0,1)),

  -- Links events together:
  --   assist → related_event_id = goal event id
  --   substitution_on → related_event_id = substitution_off event id
  related_event_id INTEGER REFERENCES match_events(id),

  created_at       TEXT DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- PLAYER MATCH STATS
-- Aggregated stats per player per match
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS player_match_stats (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id          INTEGER NOT NULL REFERENCES matches(id),
  player_id         INTEGER NOT NULL REFERENCES players(id),
  team_id           INTEGER NOT NULL REFERENCES teams(id),

  -- Participation
  is_starter        INTEGER DEFAULT 0 CHECK(is_starter IN (0,1)),
  minutes_played    INTEGER DEFAULT 0,

  -- Attacking
  goals             INTEGER DEFAULT 0,
  assists           INTEGER DEFAULT 0,
  shots_total       INTEGER DEFAULT 0,
  shots_on_target   INTEGER DEFAULT 0,
  penalties_taken   INTEGER DEFAULT 0,
  penalties_scored  INTEGER DEFAULT 0,

  -- Passing & defending
  passes_completed  INTEGER DEFAULT 0,
  passes_attempted  INTEGER DEFAULT 0,
  tackles_made      INTEGER DEFAULT 0,
  interceptions     INTEGER DEFAULT 0,
  clearances        INTEGER DEFAULT 0,
  fouls_committed   INTEGER DEFAULT 0,
  fouls_won         INTEGER DEFAULT 0,

  -- Discipline
  yellow_cards      INTEGER DEFAULT 0,
  red_cards         INTEGER DEFAULT 0,

  -- Goalkeeper only (0 for outfield)
  saves             INTEGER DEFAULT 0,
  goals_conceded    INTEGER DEFAULT 0,
  penalty_saves     INTEGER DEFAULT 0,

  UNIQUE(match_id, player_id)
);

-- ------------------------------------------------------------
-- COMPETITION — family score-picking game
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS competitors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  team_name   TEXT NOT NULL UNIQUE,    -- displayed handle (unique so we can build URLs)
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS picks (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  competitor_id            INTEGER NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  match_id                 INTEGER NOT NULL REFERENCES matches(id),
  home_score               INTEGER NOT NULL,
  away_score               INTEGER NOT NULL,
  -- NULL when the competitor picked "no goal scored" (with no_goal=1).
  -- A real player_id when they picked a specific scorer.
  first_scorer_player_id   INTEGER REFERENCES players(id),
  no_goal                  INTEGER NOT NULL DEFAULT 0 CHECK(no_goal IN (0,1)),
  is_joker                 INTEGER NOT NULL DEFAULT 0 CHECK(is_joker IN (0,1)),
  -- Filled in by the scoring engine once the match is final
  points_awarded           INTEGER,
  created_at               TEXT DEFAULT (datetime('now')),
  updated_at               TEXT DEFAULT (datetime('now')),
  UNIQUE(competitor_id, match_id)
);

-- Single-row config (id is always 1) controlling how picks are scored.
CREATE TABLE IF NOT EXISTS comp_scoring (
  id                    INTEGER PRIMARY KEY CHECK(id = 1),
  result_points         INTEGER NOT NULL DEFAULT 2,    -- correct win/draw/loss
  both_scores_points    INTEGER NOT NULL DEFAULT 5,    -- correct exact score
  one_score_points      INTEGER NOT NULL DEFAULT 1,    -- correct just one team's goals
  first_scorer_points   INTEGER NOT NULL DEFAULT 3,    -- correct first scorer (or no-goal pick)
  joker_multiplier      INTEGER NOT NULL DEFAULT 2,    -- multiplies total points on joker matches
  pen_winner_bonus_goal INTEGER NOT NULL DEFAULT 1     -- in knockouts, add this many goals to pen-winner's effective score
);

-- Seed the singleton row only on first creation
INSERT OR IGNORE INTO comp_scoring (id) VALUES (1);

-- ------------------------------------------------------------
-- POOLS — competitors can be grouped into multiple pools.
-- Picks are global to a competitor; pool membership controls which
-- leaderboards their points appear on.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pools (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT NOT NULL UNIQUE,            -- url-safe identifier, e.g. 'family', 'sams-friends'
  name        TEXT NOT NULL,                   -- display name
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pool_members (
  pool_id        INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  competitor_id  INTEGER NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  joined_at      TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (pool_id, competitor_id)
);

-- Default family pool exists on first init so the original /compete UX
-- keeps working after the multi-pool feature lands.
INSERT OR IGNORE INTO pools (id, slug, name) VALUES (1, 'family', 'Family');

-- Backfill: every existing competitor joins the family pool automatically.
-- (No-op on first init when there are no competitors yet.)
INSERT OR IGNORE INTO pool_members (pool_id, competitor_id)
  SELECT 1, id FROM competitors;

-- ------------------------------------------------------------
-- INDEXES
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_matches_stage        ON matches(stage);
CREATE INDEX IF NOT EXISTS idx_matches_group        ON matches(group_name);
CREATE INDEX IF NOT EXISTS idx_matches_status       ON matches(status);
CREATE INDEX IF NOT EXISTS idx_events_match         ON match_events(match_id);
CREATE INDEX IF NOT EXISTS idx_events_player        ON match_events(player_id);
CREATE INDEX IF NOT EXISTS idx_events_type          ON match_events(event_type);
CREATE INDEX IF NOT EXISTS idx_lineups_match        ON match_lineups(match_id);
CREATE INDEX IF NOT EXISTS idx_lineups_player       ON match_lineups(player_id);
CREATE INDEX IF NOT EXISTS idx_stats_match          ON player_match_stats(match_id);
CREATE INDEX IF NOT EXISTS idx_stats_player         ON player_match_stats(player_id);
CREATE INDEX IF NOT EXISTS idx_players_team         ON players(team_id);
CREATE INDEX IF NOT EXISTS idx_standings_group      ON group_standings(group_name);
CREATE INDEX IF NOT EXISTS idx_picks_competitor     ON picks(competitor_id);
CREATE INDEX IF NOT EXISTS idx_picks_match          ON picks(match_id);
CREATE INDEX IF NOT EXISTS idx_pool_members_pool       ON pool_members(pool_id);
CREATE INDEX IF NOT EXISTS idx_pool_members_competitor ON pool_members(competitor_id);
