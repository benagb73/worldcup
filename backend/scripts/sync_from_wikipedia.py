"""
scripts/sync_from_wikipedia.py

Pull live squad data from the Wikipedia "2026 FIFA World Cup squads" page,
diff it against the DB, and optionally apply updates.

  python -m scripts.sync_from_wikipedia             # dry run (default)
  python -m scripts.sync_from_wikipedia --apply     # commit changes

What gets synced per team:
  - teams.manager                          (head coach name)
  - players.shirt_number                   (jersey number from Wikipedia)
  - players.position                       (DF/MF/FW → DEF/MID/FWD)
  - players.intl_caps_pre                  (career caps at sync time)
  - players.intl_goals_pre                 (career goals at sync time)
  - players.date_of_birth                  (only if currently NULL — DOB rarely changes)
  - players.club_id                        (only if club name resolves to a clubs row)

What is NOT touched:
  - Team rows (other than manager)
  - Players not in the Wikipedia squad — they're warned about, not deleted
  - Clubs sheet — we look them up but don't create new ones (avoids duplicates)

Re-runs are safe: only fields with actual changes get UPDATEd, so the diff
report stays small.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys
import unicodedata
from typing import Optional

# Force UTF-8 output so accented player names don't crash on the Windows
# default cp1252 console encoding.
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import httpx
from bs4 import BeautifulSoup, Tag

from app.db.connection import get_db


WIKI_URL = "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup_squads"

# Map Wikipedia name → DB name when they differ. Both sides are _norm()'d
# (lowercased, accents stripped) so 'Türkiye' and 'turkiye' both work.
TEAM_NAME_OVERRIDES: dict[str, str] = {
    "czech republic":  "czechia",
    "korea republic":  "south korea",
    "côte d'ivoire":   "ivory coast",
    "cote d'ivoire":   "ivory coast",
    "turkey":          "turkiye",     # DB uses 'Turkiye' (no diacritic)
    "türkiye":         "turkiye",
    "turkiye":         "turkey",
    "cape verde":      "cabo verde",
    "cabo verde":      "cape verde",
}

# Wikipedia position codes → our enum
POS_MAP: dict[str, str] = {
    "GK": "GK",
    "DF": "DEF",
    "MF": "MID",
    "FW": "FWD",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _norm(s: Optional[str]) -> str:
    """Accent-stripped, lowercased, whitespace-collapsed name for matching."""
    if not s:
        return ""
    decomposed = unicodedata.normalize("NFKD", s)
    no_accents = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", no_accents).lower().strip()


def _clean(s: Optional[str]) -> str:
    """Trim + collapse whitespace, drop bracketed annotations like [1] / (captain)."""
    if not s:
        return ""
    s = re.sub(r"\[\d+\]", "", s)                                  # footnote refs
    s = re.sub(r"\(\s*captain\s*\)", "", s, flags=re.IGNORECASE)   # ( captain )
    s = re.sub(r"\s*\(c\)\s*$", "", s, flags=re.IGNORECASE)        # trailing (c)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _last_name(full: str) -> str:
    """Crude last-name extractor for fallback matching."""
    parts = _norm(full).split()
    return parts[-1] if parts else ""


def _to_int(s: Optional[str]) -> Optional[int]:
    if s is None:
        return None
    digits = re.search(r"-?\d+", s.replace(",", ""))
    return int(digits.group()) if digits else None


def _iso_dob(text: Optional[str]) -> Optional[str]:
    """Wikipedia DOB cells look like '8 November 2000 (aged 25)' or use a microformat
    span with `bday=2000-11-08`. Try the microformat first."""
    if not text:
        return None
    iso = re.search(r"\d{4}-\d{2}-\d{2}", text)
    if iso:
        return iso.group()
    # Fall back to parsing English date
    m = re.search(r"(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})", text)
    if not m:
        return None
    day, month_name, year = m.groups()
    months = {n: i for i, n in enumerate(
        ["January","February","March","April","May","June",
         "July","August","September","October","November","December"], 1)}
    mo = months.get(month_name)
    if not mo:
        return None
    return f"{int(year):04d}-{mo:02d}-{int(day):02d}"


# ---------------------------------------------------------------------------
# Page parsing
# ---------------------------------------------------------------------------

def fetch_page() -> str:
    # Wikipedia's policy requires a descriptive UA with a contact / project URL.
    # See https://meta.wikimedia.org/wiki/User-Agent_policy
    ua = ("WorldCupFamilySync/1.0 "
          "(https://github.com/benagb73/worldcup; personal family project)")
    print(f"GET {WIKI_URL}")
    r = httpx.get(WIKI_URL, headers={"User-Agent": ua}, timeout=30,
                  follow_redirects=True)
    r.raise_for_status()
    return r.text


def parse_squads(html: str) -> list[dict]:
    """Return a list of {team_name, manager, players: [...]} dicts."""
    soup = BeautifulSoup(html, "html.parser")
    # Wikipedia wraps the article body — find h3 team sections that have a wikitable
    teams: list[dict] = []
    for h3 in soup.find_all("h3"):
        # Team name lives inside the headline span
        headline = h3.find(class_="mw-headline") or h3
        team_name = _clean(headline.get_text())
        if not team_name or len(team_name) > 60:
            continue

        # The squad table is the next 'wikitable' that follows this h3
        # but BEFORE the next h3. We also want the 'Coach:' / 'Head coach:' line.
        manager = None
        table = None
        for sib in h3.find_all_next():
            if sib.name == "h3":
                break
            if sib.name in ("h2", "h1"):
                break
            if manager is None and sib.name == "p":
                txt = sib.get_text()
                m = re.search(r"(?:Head\s+coach|Coach|Manager)\s*:\s*(.+)", txt, flags=re.IGNORECASE)
                if m:
                    manager = _clean(m.group(1).split("\n")[0])
            if isinstance(sib, Tag) and "wikitable" in (sib.get("class") or []):
                table = sib
                break
        if table is None:
            continue

        players = _parse_squad_table(table)
        if not players:
            continue
        teams.append({
            "team_name": team_name,
            "manager":   manager,
            "players":   players,
        })
    return teams


def _parse_squad_table(table: Tag) -> list[dict]:
    """Pull (No, Pos, Player, DOB, Caps, Goals, Club) rows out of a squad wikitable."""
    headers = [_clean(th.get_text()).lower() for th in table.find_all("th")]
    # Find indices of the columns we care about
    def idx(*names: str) -> Optional[int]:
        for i, h in enumerate(headers):
            for n in names:
                if h.startswith(n):
                    return i
        return None
    i_no    = idx("no", "no.", "shirt", "number")
    i_pos   = idx("pos")
    i_name  = idx("player")
    i_dob   = idx("date of birth", "dob")
    i_caps  = idx("caps")
    i_goals = idx("goals")
    i_club  = idx("club")
    if None in (i_pos, i_name):
        return []

    out: list[dict] = []
    for tr in table.find_all("tr"):
        cells = tr.find_all(["td", "th"])
        if not cells or len(cells) < 4:
            continue
        # Skip header row (first row is usually all <th>)
        if all(c.name == "th" for c in cells):
            continue

        # Helper to safely fetch a cell's text by header index
        def cell(i: Optional[int]) -> str:
            if i is None or i >= len(cells):
                return ""
            return _clean(cells[i].get_text(" "))

        # DOB cell has a hidden microformat span; try that first
        dob_text = ""
        if i_dob is not None and i_dob < len(cells):
            bday = cells[i_dob].find(class_="bday")
            dob_text = bday.get_text(" ") if bday else cells[i_dob].get_text(" ")

        pos_raw  = cell(i_pos).upper()
        # Wikipedia uses prefixed codes like "1GK" / "2DF" for sort order, plus
        # occasional suffixes like "FW (RW)". Strip everything that isn't the
        # 2-letter position code.
        match_pos = re.search(r"\b(GK|DF|MF|FW)\b", pos_raw)
        position = POS_MAP.get(match_pos.group(1)) if match_pos else None

        # Club cell. Wikipedia formats it as "[flag] Club Name (Country)".
        # We extract the country from the parenthesised suffix (which is the
        # English country name) rather than the flag's alt attribute (which is
        # often the federation name like "Brazilian Football Confederation").
        # Fall back to the flag alt if no parens are present.
        club_name    = ""
        club_country = None
        if i_club is not None and i_club < len(cells):
            club_cell = cells[i_club]
            full_text = _clean(club_cell.get_text(" "))
            m = re.search(r"\s*\(([^)]+)\)\s*$", full_text)
            if m:
                club_country = m.group(1).strip()
                club_name    = full_text[:m.start()].strip()
            else:
                club_name = full_text
                img = club_cell.find("img")
                if img and img.get("alt"):
                    club_country = img["alt"].strip()

        out.append({
            "shirt_number": _to_int(cell(i_no)),
            "position":     position,
            "name":         cell(i_name),
            "dob":          _iso_dob(dob_text),
            "caps":         _to_int(cell(i_caps)),
            "goals":        _to_int(cell(i_goals)),
            "club_name":    club_name,
            "club_country": club_country,
        })
    return out


# ---------------------------------------------------------------------------
# Diff + apply
# ---------------------------------------------------------------------------

async def _ensure_schema_columns(db) -> None:
    """ALTER TABLE ADD COLUMN for the new fields if they're not already present.
    Idempotent: skip silently if the column exists. Required when the target DB
    (e.g. Turso) was created before these columns were added to schema.sql."""
    needed = [
        ("teams",   "manager",        "TEXT"),
        ("players", "intl_caps_pre",  "INTEGER DEFAULT 0"),
        ("players", "intl_goals_pre", "INTEGER DEFAULT 0"),
    ]
    for table, col, decl in needed:
        cols = await db.fetchall(f"PRAGMA table_info({table})")
        existing = {c["name"] for c in cols}
        if col in existing:
            continue
        print(f"  schema: adding {table}.{col}")
        await db.execute(f"ALTER TABLE {table} ADD COLUMN {col} {decl}")


async def diff_and_apply(
    parsed: list[dict],
    apply: bool,
    *,
    full_sync: bool = False,
) -> None:
    summary = {
        "team_updates": 0, "player_updates": 0,
        "players_inserted": 0, "players_deleted": 0,
        "missing_teams": [], "missing_players": [], "extra_players": [],
        "unresolved_clubs": set(),
    }

    async with get_db() as db:
        # Make sure the new columns exist on whatever DB we're talking to.
        # Required because Turso DBs initialised before the schema additions
        # need the ALTER TABLE step here.
        await _ensure_schema_columns(db)

        db_teams = await db.fetchall("SELECT id, name, code, manager FROM teams")

        # Build a normalized-name → club_id lookup (only used in full-sync)
        clubs_by_norm: dict[str, int] = {}
        if full_sync:
            for c in await db.fetchall("SELECT id, name FROM clubs"):
                clubs_by_norm[_norm(c["name"])] = c["id"]
        team_by_norm: dict[str, dict] = {}
        for t in db_teams:
            team_by_norm[_norm(t["name"])] = t
            team_by_norm[_norm(t["code"])] = t  # also let codes match

        for wt in parsed:
            wiki_name = wt["team_name"]
            # Apply name override if known
            lookup_name = TEAM_NAME_OVERRIDES.get(_norm(wiki_name), _norm(wiki_name))
            t = team_by_norm.get(lookup_name) or team_by_norm.get(_norm(wiki_name))
            if not t:
                summary["missing_teams"].append(wiki_name)
                print(f"[skip team] '{wiki_name}' — not in DB (add an override or check the name)")
                continue

            print(f"\n{t['name']} ({t['code']})")
            # ---- Team-level: manager
            if (wt["manager"] or "").strip() and wt["manager"].strip() != (t["manager"] or "").strip():
                print(f"  manager: {t['manager']!r} -> {wt['manager']!r}")
                if apply:
                    await db.execute("UPDATE teams SET manager = ? WHERE id = ?",
                                     [wt["manager"], t["id"]])
                summary["team_updates"] += 1

            # ---- Player-level: pull current DB roster for this team
            db_players = await db.fetchall(
                "SELECT id, name, shirt_number, position, intl_caps_pre, intl_goals_pre, "
                "date_of_birth, club_id, club_status "
                "FROM players WHERE team_id = ?", [t["id"]]
            )
            by_norm = {_norm(p["name"]): p for p in db_players}

            # Build secondary lookups for fuzzy matching
            by_lastname: dict[str, list[dict]] = {}
            for p in db_players:
                by_lastname.setdefault(_last_name(p["name"]), []).append(p)

            seen: set[int] = set()
            for wp in wt["players"]:
                name_n = _norm(wp["name"])
                p = by_norm.get(name_n)
                # Substring match in either direction (handles "K. Mbappé" vs "Kylian Mbappé")
                if not p:
                    for k, v in by_norm.items():
                        if name_n and k and (name_n in k or k in name_n):
                            p = v; break
                # Last-name fallback when there's exactly one candidate in this squad
                if not p:
                    ln_candidates = by_lastname.get(_last_name(wp["name"]), [])
                    # Avoid grabbing already-matched players
                    ln_candidates = [c for c in ln_candidates if c["id"] not in seen]
                    if len(ln_candidates) == 1:
                        p = ln_candidates[0]
                if not p:
                    summary["missing_players"].append(f"{t['code']} · {wp['name']}")
                    if full_sync:
                        # Insert this player into the DB so the squad matches Wikipedia
                        new_club_id = None
                        if wp.get("club_name"):
                            raw = re.sub(r"\(.*?\)", "", wp["club_name"]).strip()
                            new_club_id = clubs_by_norm.get(_norm(raw))
                            if raw and new_club_id is None:
                                summary["unresolved_clubs"].add(raw)
                        print(f"  [INSERT — new from wiki] {wp['name']} #{wp['shirt_number']} ({wp['position']})")
                        if apply:
                            await db.execute("""
                                INSERT INTO players
                                  (team_id, club_id, name, shirt_number, position,
                                   date_of_birth, intl_caps_pre, intl_goals_pre)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            """, [t["id"], new_club_id, wp["name"],
                                  wp.get("shirt_number"), wp.get("position"),
                                  wp.get("dob"),
                                  wp.get("caps") or 0, wp.get("goals") or 0])
                        summary["players_inserted"] = summary.get("players_inserted", 0) + 1
                    else:
                        print(f"  [new player on wiki] {wp['name']} #{wp['shirt_number']} ({wp['position']})")
                    continue
                seen.add(p["id"])
                changes = _compute_player_changes(
                    p, wp,
                    full_sync=full_sync,
                    clubs_by_norm=clubs_by_norm if full_sync else None,
                )
                if not changes:
                    continue
                summary["player_updates"] += 1
                for field, (old, new) in changes.items():
                    print(f"  {wp['name']:<28}{field}: {old!r} -> {new!r}")
                if apply:
                    await _apply_player_update(db, p["id"], changes)
                # Track unresolved club names so user can add to xlsx
                if full_sync and wp.get("club_name"):
                    raw = re.sub(r"\(.*?\)", "", wp["club_name"]).strip()
                    if raw and _norm(raw) not in clubs_by_norm:
                        summary["unresolved_clubs"].add(raw)

            # Players in DB but not in Wikipedia. With full_sync we delete them
            # (after clearing pick references); otherwise we just warn.
            for p in db_players:
                if p["id"] in seen:
                    continue
                summary["extra_players"].append(f"{t['code']} · {p['name']}")
                if full_sync:
                    print(f"  [DELETE — not on wiki] {p['name']}")
                    if apply:
                        await _delete_player(db, p["id"])
                    summary["players_deleted"] += 1
                else:
                    print(f"  [not on wiki] {p['name']}")

    # --------- summary ---------
    print("\n" + "=" * 60)
    mode = "APPLIED" if apply else "DRY RUN"
    if full_sync:
        mode += " (FULL SYNC — DOB/club overwritten, missing players DELETED)"
    print(f"  {mode}")
    print(f"  Team updates:           {summary['team_updates']}")
    print(f"  Player updates:         {summary['player_updates']}")
    if full_sync:
        print(f"  Players inserted:       {summary['players_inserted']}")
        print(f"  Players deleted:        {summary['players_deleted']}")
    print(f"  Wiki teams not in DB:   {len(summary['missing_teams'])}")
    if not full_sync:
        print(f"  Wiki players not in DB: {len(summary['missing_players'])} (run --full-sync to INSERT)")
        print(f"  DB players not on Wiki: {len(summary['extra_players'])} (run --full-sync to DELETE)")
    if summary["unresolved_clubs"]:
        print(f"\n  {len(summary['unresolved_clubs'])} club names from Wikipedia weren't in your clubs table:")
        for c in sorted(summary["unresolved_clubs"])[:20]:
            print(f"    - {c}")
        if len(summary["unresolved_clubs"]) > 20:
            print(f"    ...and {len(summary['unresolved_clubs']) - 20} more")
        print("  Add them to your xlsx clubs sheet (and re-seed) for proper club display.")
    if not apply:
        print("\n  Re-run with --apply to commit these changes.")


def _compute_player_changes(
    db_row: dict, wiki: dict,
    *,                              # forces keyword args
    full_sync: bool = False,
    clubs_by_norm: dict | None = None,
) -> dict:
    """Return {field: (old, new)} for fields that differ.

    With full_sync=True, also overwrites DOB whenever Wikipedia has a value,
    and resolves the club name to a club_id when one's available in our clubs
    table.
    """
    changes: dict = {}
    if wiki["shirt_number"] is not None and wiki["shirt_number"] != db_row.get("shirt_number"):
        changes["shirt_number"] = (db_row.get("shirt_number"), wiki["shirt_number"])
    if wiki["position"] and wiki["position"] != db_row.get("position"):
        changes["position"] = (db_row.get("position"), wiki["position"])
    if wiki["caps"] is not None and wiki["caps"] != (db_row.get("intl_caps_pre") or 0):
        changes["intl_caps_pre"] = (db_row.get("intl_caps_pre"), wiki["caps"])
    if wiki["goals"] is not None and wiki["goals"] != (db_row.get("intl_goals_pre") or 0):
        changes["intl_goals_pre"] = (db_row.get("intl_goals_pre"), wiki["goals"])

    # Date of birth: always overwrite in full_sync mode; otherwise only fill blanks
    if wiki["dob"]:
        old_dob = db_row.get("date_of_birth")
        if full_sync and old_dob != wiki["dob"]:
            changes["date_of_birth"] = (old_dob, wiki["dob"])
        elif not old_dob:
            changes["date_of_birth"] = (None, wiki["dob"])

    # Club: only when full_sync + we have a clubs lookup. Strips parenthesised
    # country suffix ("Slavia Prague (Czech Rep.)") before matching.
    if full_sync and clubs_by_norm is not None and wiki.get("club_name"):
        raw = re.sub(r"\(.*?\)", "", wiki["club_name"]).strip()
        new_club_id = clubs_by_norm.get(_norm(raw))
        if new_club_id is not None and new_club_id != db_row.get("club_id"):
            changes["club_id"] = (db_row.get("club_id"), new_club_id)

    return changes


async def _apply_player_update(db, player_id: int, changes: dict) -> None:
    sets, params = [], []
    for field, (_, new) in changes.items():
        sets.append(f"{field} = ?")
        params.append(new)
    params.append(player_id)
    await db.execute(f"UPDATE players SET {', '.join(sets)} WHERE id = ?", params)


async def _delete_player(db, player_id: int) -> None:
    """Safely delete a player by clearing every FK reference first.

    This is only used in --full-sync mode for players the user has confirmed
    are no longer in the squad per Wikipedia. Pre-tournament, the only
    references should be picks.first_scorer_player_id and possibly
    match_lineups / match_events from admin testing — all safe to clear.
    """
    # Null out family-pool first-scorer picks
    await db.execute(
        "UPDATE picks SET first_scorer_player_id = NULL "
        "WHERE first_scorer_player_id = ?",
        [player_id]
    )
    # Clear any test-mode events / lineups / stats
    await db.execute("DELETE FROM player_match_stats WHERE player_id = ?", [player_id])
    await db.execute("DELETE FROM match_lineups       WHERE player_id = ?", [player_id])
    await db.execute(
        "UPDATE match_events SET related_event_id = NULL "
        "WHERE related_event_id IN (SELECT id FROM match_events WHERE player_id = ?)",
        [player_id]
    )
    await db.execute("DELETE FROM match_events WHERE player_id = ?", [player_id])
    # Finally the player row itself
    await db.execute("DELETE FROM players WHERE id = ?", [player_id])


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

async def main():
    p = argparse.ArgumentParser(description="Sync squads from Wikipedia.")
    p.add_argument("--apply", action="store_true",
                   help="Commit the diff (default is dry run).")
    p.add_argument("--full-sync", action="store_true",
                   help="Trust Wikipedia fully: also overwrite DOB + club, "
                        "AND delete DB players not in the Wikipedia squad.")
    p.add_argument("--html-file", help="Read HTML from a local file instead of fetching")
    args = p.parse_args()

    if args.html_file:
        with open(args.html_file, encoding="utf-8") as f:
            html = f.read()
    else:
        html = fetch_page()

    parsed = parse_squads(html)
    print(f"\nParsed {len(parsed)} team sections from the page.")

    await diff_and_apply(parsed, apply=args.apply, full_sync=args.full_sync)


if __name__ == "__main__":
    asyncio.run(main())
