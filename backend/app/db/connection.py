"""
db/connection.py
Unified database connection that works with:
  - Local SQLite  (TURSO_URL not set, for development)
  - Turso / libSQL (TURSO_URL + TURSO_TOKEN set, for production)
"""

import os
import sqlite3
from contextlib import asynccontextmanager
from typing import Any

from dotenv import load_dotenv

load_dotenv()

TURSO_URL   = os.getenv("TURSO_URL")      # libsql://your-db.turso.io
TURSO_TOKEN = os.getenv("TURSO_TOKEN")    # eyJ...
LOCAL_DB    = os.getenv("LOCAL_DB_PATH", "worldcup.db")

_USE_TURSO = bool(TURSO_URL and TURSO_TOKEN)

# ---------------------------------------------------------------------------
# Turso path
# ---------------------------------------------------------------------------
if _USE_TURSO:
    import libsql_client  # type: ignore

    async def _get_turso_client():
        return libsql_client.create_client(
            url=TURSO_URL,
            auth_token=TURSO_TOKEN,
        )

    @asynccontextmanager
    async def get_db():
        client = await _get_turso_client()
        try:
            yield TursoAdapter(client)
        finally:
            await client.close()

    class TursoAdapter:
        """Thin wrapper that makes Turso client feel like sqlite3."""

        def __init__(self, client):
            self._client = client
            self._batch: list[tuple[str, list]] = []

        async def execute(self, sql: str, params: list | tuple = ()) -> list[dict]:
            rs = await self._client.execute(sql, list(params))
            cols = [c.name for c in rs.columns]
            return [dict(zip(cols, row)) for row in rs.rows]

        async def executemany(self, sql: str, param_list: list[list | tuple]):
            stmts = [libsql_client.Statement(sql, list(p)) for p in param_list]
            await self._client.batch(stmts)

        async def execute_script(self, sql: str):
            """Run a multi-statement SQL script (schema setup)."""
            statements = [s.strip() for s in sql.split(";") if s.strip()]
            stmts = [libsql_client.Statement(s) for s in statements]
            await self._client.batch(stmts)

        async def fetchone(self, sql: str, params: list | tuple = ()) -> dict | None:
            rows = await self.execute(sql, params)
            return rows[0] if rows else None

        async def fetchall(self, sql: str, params: list | tuple = ()) -> list[dict]:
            return await self.execute(sql, params)

# ---------------------------------------------------------------------------
# Local SQLite path
# ---------------------------------------------------------------------------
else:

    @asynccontextmanager
    async def get_db():  # type: ignore[misc]
        conn = sqlite3.connect(LOCAL_DB, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield SQLiteAdapter(conn)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    class SQLiteAdapter:  # type: ignore[no-redef]
        """Sqlite3 wrapper with the same async interface as TursoAdapter."""

        def __init__(self, conn: sqlite3.Connection):
            self._conn = conn

        async def execute(self, sql: str, params: list | tuple = ()) -> list[dict]:
            cur = self._conn.execute(sql, params)
            cols = [d[0] for d in cur.description] if cur.description else []
            return [dict(zip(cols, row)) for row in cur.fetchall()]

        async def executemany(self, sql: str, param_list: list[list | tuple]):
            self._conn.executemany(sql, param_list)

        async def execute_script(self, sql: str):
            self._conn.executescript(sql)

        async def fetchone(self, sql: str, params: list | tuple = ()) -> dict | None:
            rows = await self.execute(sql, params)
            return rows[0] if rows else None

        async def fetchall(self, sql: str, params: list | tuple = ()) -> list[dict]:
            return await self.execute(sql, params)


# ---------------------------------------------------------------------------
# Schema initialisation
# ---------------------------------------------------------------------------
async def init_db():
    """Create all tables if they don't exist. Safe to call on every startup."""
    schema_path = os.path.join(os.path.dirname(__file__), "..", "schema.sql")
    with open(schema_path) as f:
        sql = f.read()
    async with get_db() as db:
        await db.execute_script(sql)
    print(f"✓ Database initialised ({'Turso' if _USE_TURSO else 'SQLite'})")
