"""
scripts/seed_db.py

Seeds the database with:
  - Teams (all 48 for 2026 World Cup format, or 32 for 2022)
  - Venues
  - Match schedule (group stage fixtures)
  - Initial bracket slots for knockout rounds
  - Group standings (zeroed out)

Usage:
  python -m scripts.seed_db

This is a one-time operation at tournament start. Edit TEAMS and FIXTURES
below with real data once the draw is made.
"""

import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.db.connection import get_db, init_db

# ---------------------------------------------------------------------------
# 2026 World Cup — edit once draw is confirmed
# Format: 16 groups of 3 teams (48 teams total), top 2 + 8 best 3rd place qualify
# ---------------------------------------------------------------------------

TEAMS = [
    # (name, code, group, flag_url)
    # --- Group A ---
    ("United States",  "USA", "A", "https://flagcdn.com/w80/us.png"),
    ("Mexico",         "MEX", "A", "https://flagcdn.com/w80/mx.png"),
    ("Canada",         "CAN", "A", "https://flagcdn.com/w80/ca.png"),
    # --- Group B ---
    ("England",        "ENG", "B", "https://flagcdn.com/w80/gb-eng.png"),
    ("France",         "FRA", "B", "https://flagcdn.com/w80/fr.png"),
    ("Australia",      "AUS", "B", "https://flagcdn.com/w80/au.png"),
    # --- Group C ---
    ("Brazil",         "BRA", "C", "https://flagcdn.com/w80/br.png"),
    ("Argentina",      "ARG", "C", "https://flagcdn.com/w80/ar.png"),
    ("Bolivia",        "BOL", "C", "https://flagcdn.com/w80/bo.png"),
    # --- Group D ---
    ("Spain",          "ESP", "D", "https://flagcdn.com/w80/es.png"),
    ("Germany",        "GER", "D", "https://flagcdn.com/w80/de.png"),
    ("Japan",          "JPN", "D", "https://flagcdn.com/w80/jp.png"),
    # --- Group E ---
    ("Portugal",       "POR", "E", "https://flagcdn.com/w80/pt.png"),
    ("Netherlands",    "NED", "E", "https://flagcdn.com/w80/nl.png"),
    ("South Korea",    "KOR", "E", "https://flagcdn.com/w80/kr.png"),
    # --- Group F ---
    ("Italy",          "ITA", "F", "https://flagcdn.com/w80/it.png"),
    ("Belgium",        "BEL", "F", "https://flagcdn.com/w80/be.png"),
    ("Morocco",        "MAR", "F", "https://flagcdn.com/w80/ma.png"),
    # --- Group G ---
    ("Colombia",       "COL", "G", "https://flagcdn.com/w80/co.png"),
    ("Ecuador",        "ECU", "G", "https://flagcdn.com/w80/ec.png"),
    ("Senegal",        "SEN", "G", "https://flagcdn.com/w80/sn.png"),
    # --- Group H ---
    ("Croatia",        "CRO", "H", "https://flagcdn.com/w80/hr.png"),
    ("Uruguay",        "URU", "H", "https://flagcdn.com/w80/uy.png"),
    ("Saudi Arabia",   "KSA", "H", "https://flagcdn.com/w80/sa.png"),
]

VENUES = [
    # (name, city, country, capacity)
    ("MetLife Stadium",          "East Rutherford", "USA", 82500),
    ("AT&T Stadium",             "Arlington",       "USA", 80000),
    ("SoFi Stadium",             "Inglewood",       "USA", 70240),
    ("Estadio Azteca",           "Mexico City",     "MEX", 87523),
    ("Estadio BBVA",             "Monterrey",       "MEX", 51300),
    ("BC Place",                 "Vancouver",       "CAN", 54500),
    ("Arrowhead Stadium",        "Kansas City",     "USA", 76416),
    ("Levi's Stadium",           "Santa Clara",     "USA", 68500),
    ("Hard Rock Stadium",        "Miami",           "USA", 64767),
    ("Lincoln Financial Field",  "Philadelphia",    "USA", 69328),
    ("Gillette Stadium",         "Foxborough",      "USA", 65878),
    ("Seattle Sounders Stadium", "Seattle",         "USA", 69000),
    ("Estadio Akron",            "Guadalajara",     "MEX", 49850),
    ("Commonwealth Stadium",     "Edmonton",        "CAN", 56302),
    ("Estadio Ciudad de la Educación", "Guadalajara", "MEX", 50000),
    ("NRG Stadium",              "Houston",         "USA", 71054),
]

# Placeholder fixtures — replace with official schedule once released.
# Format: (match_number_str, group, home_code, away_code, scheduled_at_utc, venue_name)
# match_number_str is used to map to API-Football fixture IDs after seeding.
FIXTURES = [
    # Group A
    ("G_A_1", "A", "USA", "MEX", "2026-06-11T21:00:00Z", "MetLife Stadium"),
    ("G_A_2", "A", "CAN", "USA", "2026-06-15T18:00:00Z", "BC Place"),
    ("G_A_3", "A", "MEX", "CAN", "2026-06-19T01:00:00Z", "AT&T Stadium"),
    # Group B
    ("G_B_1", "B", "ENG", "AUS", "2026-06-12T01:00:00Z", "Levi's Stadium"),
    ("G_B_2", "B", "FRA", "ENG", "2026-06-16T21:00:00Z", "MetLife Stadium"),
    ("G_B_3", "B", "AUS", "FRA", "2026-06-20T01:00:00Z", "Hard Rock Stadium"),
    # Group C
    ("G_C_1", "C", "BRA", "BOL", "2026-06-12T21:00:00Z", "AT&T Stadium"),
    ("G_C_2", "C", "ARG", "BRA", "2026-06-16T01:00:00Z", "Hard Rock Stadium"),
    ("G_C_3", "C", "BOL", "ARG", "2026-06-20T21:00:00Z", "Arrowhead Stadium"),
    # Group D
    ("G_D_1", "D", "GER", "JPN", "2026-06-13T01:00:00Z", "Gillette Stadium"),
    ("G_D_2", "D", "ESP", "GER", "2026-06-17T21:00:00Z", "AT&T Stadium"),
    ("G_D_3", "D", "JPN", "ESP", "2026-06-21T01:00:00Z", "BC Place"),
    # Group E
    ("G_E_1", "E", "POR", "KOR", "2026-06-13T18:00:00Z", "Arrowhead Stadium"),
    ("G_E_2", "E", "NED", "POR", "2026-06-17T18:00:00Z", "Lincoln Financial Field"),
    ("G_E_3", "E", "KOR", "NED", "2026-06-21T21:00:00Z", "NRG Stadium"),
    # Group F
    ("G_F_1", "F", "ITA", "MAR", "2026-06-14T01:00:00Z", "NRG Stadium"),
    ("G_F_2", "F", "BEL", "ITA", "2026-06-18T01:00:00Z", "SoFi Stadium"),
    ("G_F_3", "F", "MAR", "BEL", "2026-06-22T01:00:00Z", "Levi's Stadium"),
    # Group G
    ("G_G_1", "G", "COL", "ECU", "2026-06-14T18:00:00Z", "SoFi Stadium"),
    ("G_G_2", "G", "SEN", "COL", "2026-06-18T18:00:00Z", "Estadio Azteca"),
    ("G_G_3", "G", "ECU", "SEN", "2026-06-22T18:00:00Z", "Estadio BBVA"),
    # Group H
    ("G_H_1", "H", "CRO", "KSA", "2026-06-15T01:00:00Z", "Seattle Sounders Stadium"),
    ("G_H_2", "H", "URU", "CRO", "2026-06-19T18:00:00Z", "Hard Rock Stadium"),
    ("G_H_3", "H", "KSA", "URU", "2026-06-23T01:00:00Z", "Arrowhead Stadium"),
]

# Knockout bracket seeds — filled once group stage ends
# Format: (stage, slot, home_desc, away_desc)
BRACKET_SEEDS = [
    ("r32", 1,  "Winner A",      "Best 3rd (B/C/D)"),
    ("r32", 2,  "Winner B",      "Best 3rd (A/C/E)"),
    ("r32", 3,  "Winner C",      "Best 3rd (A/B/F)"),
    ("r32", 4,  "Winner D",      "Runner-up A"),
    ("r32", 5,  "Winner E",      "Runner-up B"),
    ("r32", 6,  "Winner F",      "Runner-up C"),
    ("r32", 7,  "Winner G",      "Runner-up D"),
    ("r32", 8,  "Winner H",      "Runner-up E"),
    ("r32", 9,  "Runner-up F",   "Runner-up G"),
    ("r32", 10, "Runner-up H",   "Best 3rd (D/E/F)"),
    ("r32", 11, "Best 3rd X",    "Best 3rd Y"),
    ("r32", 12, "Best 3rd Z",    "Best 3rd W"),
    # R16 through final pre-seeded but teams NULL
    ("r16", 1,  "Winner R32-1",  "Winner R32-2"),
    ("r16", 2,  "Winner R32-3",  "Winner R32-4"),
    ("r16", 3,  "Winner R32-5",  "Winner R32-6"),
    ("r16", 4,  "Winner R32-7",  "Winner R32-8"),
    ("r16", 5,  "Winner R32-9",  "Winner R32-10"),
    ("r16", 6,  "Winner R32-11", "Winner R32-12"),
    ("r16", 7,  "TBD",           "TBD"),
    ("r16", 8,  "TBD",           "TBD"),
    ("qf",  1,  "Winner R16-1",  "Winner R16-2"),
    ("qf",  2,  "Winner R16-3",  "Winner R16-4"),
    ("qf",  3,  "Winner R16-5",  "Winner R16-6"),
    ("qf",  4,  "Winner R16-7",  "Winner R16-8"),
    ("sf",  1,  "Winner QF-1",   "Winner QF-2"),
    ("sf",  2,  "Winner QF-3",   "Winner QF-4"),
    ("third_place", 1, "Loser SF-1", "Loser SF-2"),
    ("final",       1, "Winner SF-1","Winner SF-2"),
]


async def seed():
    await init_db()

    async with get_db() as db:
        # Teams
        for name, code, group, flag in TEAMS:
            await db.execute("""
                INSERT OR IGNORE INTO teams (name, code, group_name, flag_url)
                VALUES (?, ?, ?, ?)
            """, [name, code, group, flag])
        print(f"[OK] Seeded {len(TEAMS)} teams")

        # Venues
        for v_name, city, country, cap in VENUES:
            await db.execute("""
                INSERT OR IGNORE INTO venues (name, city, country, capacity)
                VALUES (?, ?, ?, ?)
            """, [v_name, city, country, cap])
        print(f"[OK] Seeded {len(VENUES)} venues")

        # Standings rows (zeroed out)
        for name, code, group, _ in TEAMS:
            team = await db.fetchone("SELECT id FROM teams WHERE code = ?", [code])
            if team:
                await db.execute("""
                    INSERT OR IGNORE INTO group_standings (group_name, team_id)
                    VALUES (?, ?)
                """, [group, team["id"]])
        print("[OK] Initialised group standings")

        # Fixtures
        for match_num, group, home_code, away_code, sched, venue_name in FIXTURES:
            home  = await db.fetchone("SELECT id FROM teams   WHERE code = ?", [home_code])
            away  = await db.fetchone("SELECT id FROM teams   WHERE code = ?", [away_code])
            venue = await db.fetchone("SELECT id FROM venues  WHERE name = ?", [venue_name])
            if not home or not away:
                print(f"  [SKIP] {match_num}: team not found")
                continue
            await db.execute("""
                INSERT OR IGNORE INTO matches
                  (stage, group_name, match_number, home_team_id, away_team_id, scheduled_at, venue_id)
                VALUES ('group', ?, ?, ?, ?, ?, ?)
            """, [group, match_num, home["id"], away["id"], sched,
                  venue["id"] if venue else None])
        print(f"[OK] Seeded {len(FIXTURES)} fixtures")

        # Bracket
        for stage, slot, home_desc, away_desc in BRACKET_SEEDS:
            await db.execute("""
                INSERT OR IGNORE INTO bracket (stage, slot, home_seed_desc, away_seed_desc)
                VALUES (?, ?, ?, ?)
            """, [stage, slot, home_desc, away_desc])
        print(f"[OK] Seeded {len(BRACKET_SEEDS)} bracket slots")

    print("\nDatabase seeded successfully!")


if __name__ == "__main__":
    asyncio.run(seed())
