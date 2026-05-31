"""Standalone Turso connection sanity check. Run it from the backend folder."""
import asyncio, os, libsql_client

async def main():
    url   = os.environ.get("TURSO_URL", "")
    token = os.environ.get("TURSO_TOKEN", "")
    print(f"URL  : {url!r}")
    print(f"Token: {len(token)} chars (starts {token[:8]!r})")
    print()

    # NB: create_client must run inside the event loop (it builds an aiohttp session)
    client = libsql_client.create_client(url=url, auth_token=token)
    try:
        rs = await client.execute("SELECT 1 AS x")
        print("SUCCESS — got rows:", list(rs.rows))
    finally:
        await client.close()

asyncio.run(main())