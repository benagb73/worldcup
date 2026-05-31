# PowerShell command reference

Every command you might need to run during this project, grouped by purpose.
All commands are PowerShell on Windows. Open PowerShell (not CMD) and paste.

> **Project paths**
> Backend: `C:\Users\benat\OneDrive\Documents\GitHub\WorldCup\backend`
> Frontend: `C:\Users\benat\OneDrive\Documents\GitHub\WorldCup\frontend`
> Data: `C:\Users\benat\OneDrive\Documents\GitHub\WorldCup\data\worldcup.xlsx`
> Admin password: `Rosie` (the value of `SYNC_SECRET` in `backend\.env`)

---

## 1 · Running the site locally

You need **two PowerShell windows** — one for backend, one for frontend. Both must be running for the site to work.

### Start the backend (port 8000)

```powershell
cd C:\Users\benat\OneDrive\Documents\GitHub\WorldCup\backend
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Starts the FastAPI server. Leave the window open. Press `Ctrl+C` to stop.

### Start the frontend (port 3000)

```powershell
cd C:\Users\benat\OneDrive\Documents\GitHub\WorldCup\frontend
npm run dev
```

Starts the Next.js dev server. Open <http://localhost:3000> in your browser. `Ctrl+C` to stop.

### One-time dependency install (only after fresh clone)

```powershell
# Backend Python deps
cd C:\Users\benat\OneDrive\Documents\GitHub\WorldCup\backend
pip install -r requirements.txt

# Frontend Node deps
cd C:\Users\benat\OneDrive\Documents\GitHub\WorldCup\frontend
npm install
```

---

## 2 · Database management

### Re-seed the local DB from the xlsx file

```powershell
cd C:\Users\benat\OneDrive\Documents\GitHub\WorldCup\backend
python -m scripts.seed_from_xlsx
```

Wipes all tournament data and re-imports from `data\worldcup.xlsx`. **Safe to run any time before the tournament starts and before any family member has saved picks.** Once picks exist, this will break their foreign-key references — don't run it then.

### Re-seed when Excel has the xlsx file open (locked)

```powershell
cd C:\Users\benat\OneDrive\Documents\GitHub\WorldCup
Copy-Item data\worldcup.xlsx data\.worldcup-tmp.xlsx -Force
cd backend
python -m scripts.seed_from_xlsx --file C:\Users\benat\OneDrive\Documents\GitHub\WorldCup\data\.worldcup-tmp.xlsx
cd ..
Remove-Item data\.worldcup-tmp.xlsx -Force
```

Excel keeps an exclusive lock on the workbook; this copies it to a temp file the seeder can read, then deletes the copy.

### Generate a fresh xlsx template

```powershell
cd C:\Users\benat\OneDrive\Documents\GitHub\WorldCup\backend
python -m scripts.seed_from_xlsx --init
```

Only do this if you've deleted the existing `data\worldcup.xlsx` and want to start over. Creates an empty template with column headers and example rows.

### Delete the local DB to start fresh

```powershell
Remove-Item C:\Users\benat\OneDrive\Documents\GitHub\WorldCup\backend\worldcup.db -Force
```

Next time you start the backend (or run the seeder), it'll create a new empty DB with the latest schema. Use this if the schema has changed and you're getting odd errors.

---

## 3 · Port / process troubleshooting

### Find what's holding port 3000 or 8000

```powershell
netstat -ano | findstr :3000
netstat -ano | findstr :8000
```

Shows a line with the PID (process ID) in the last column. Useful when you see "port in use" errors.

### Kill a stuck process by PID

```powershell
Stop-Process -Id <PID> -Force
```

Replace `<PID>` with the number from `netstat`. If it fails with "Access denied", try the alternate form below.

### Alternate: nuke a process

```powershell
taskkill /F /PID <PID>
```

Sometimes succeeds when `Stop-Process` doesn't.

### Clear Next.js build cache (fixes weird HMR errors)

```powershell
cd C:\Users\benat\OneDrive\Documents\GitHub\WorldCup\frontend
Remove-Item -Recurse -Force .next
```

When the dev server starts behaving oddly ("Cannot find module './102.js'" etc.), wipe `.next` and restart `npm run dev`.

---

## 4 · Quick API smoke tests

### Is the backend up?

```powershell
curl.exe http://127.0.0.1:8000/api/health
```

Should return `{"status":"ok"}`. Note: use `curl.exe` (not just `curl`) — in PowerShell, `curl` is an alias for `Invoke-WebRequest`, which prompts a "Security Warning" on every request. `curl.exe` invokes the real curl binary directly.

### Read all group standings

```powershell
curl.exe http://127.0.0.1:8000/api/groups
```

### Hit any admin endpoint (requires the secret)

```powershell
curl.exe -H "X-Admin-Secret: Rosie" http://127.0.0.1:8000/api/admin/matches
```

The header authenticates you as admin. Same secret as the `/admin` UI login.

### List family-pool competitors

```powershell
curl.exe http://127.0.0.1:8000/api/compete/competitors
```

---

## 5 · Seeding the production Turso database

After you've created your Turso DB in the dashboard (per `DEPLOY.md`), run the seeder locally pointed at the cloud DB. **Env vars are set for the current shell only and disappear when you close the window.**

```powershell
cd C:\Users\benat\OneDrive\Documents\GitHub\WorldCup\backend

# Paste your real values from the Turso dashboard
$env:TURSO_URL  = "libsql://worldcup-yourname.aws-us-east-1.turso.io"
$env:TURSO_TOKEN = "eyJ...your-long-token..."

python -m scripts.seed_from_xlsx
```

The connection code auto-routes to Turso when both env vars are present. Verify in the Turso dashboard → Browse: `SELECT COUNT(*) FROM teams;` should return 48.

---

## 6 · Fly.io deployment commands

All run from the **backend** folder unless noted.

### Install the Fly CLI (one-time)

```powershell
iwr https://fly.io/install.ps1 -useb | iex
```

Restart PowerShell after installing so `flyctl` is on PATH.

### Sign in to Fly

```powershell
flyctl auth login
```

Opens a browser. Sign in with GitHub if you used that to sign up.

### Create the app (one-time)

```powershell
cd C:\Users\benat\OneDrive\Documents\GitHub\WorldCup\backend
flyctl apps create worldcup-backend     # pick your own globally-unique name
```

Then open `fly.toml` and change the `app = "worldcup-backend"` line to match.

### Set production secrets

```powershell
flyctl secrets set `
  TURSO_URL="libsql://worldcup-yourname.aws-us-east-1.turso.io" `
  TURSO_TOKEN="eyJ..." `
  SYNC_SECRET="Rosie" `
  ALLOWED_ORIGINS="https://worldcup-yourname.vercel.app"
```

The backtick (\`) at the end of each line is the PowerShell line-continuation character. After running this, Fly automatically redeploys.

### Deploy / redeploy after code changes

```powershell
cd C:\Users\benat\OneDrive\Documents\GitHub\WorldCup\backend
flyctl deploy
```

Builds the Docker image, pushes it, restarts the app. Takes 1–3 minutes.

### Watch live logs

```powershell
flyctl logs -a worldcup-backend
```

Streams the backend's stdout. `Ctrl+C` to stop. Useful when debugging a production issue.

### Check machine status

```powershell
flyctl status -a worldcup-backend
```

Shows whether your machine is `started` or `stopped` (auto-stop should put it in `stopped` when idle).

### Check your bill so far this month

```powershell
flyctl billing show
```

Run this weekly during the first month. Should show pennies. If it ever shows more than a couple of dollars, investigate.

### Emergency: stop billing immediately

```powershell
# Soft stop — scale to zero machines
flyctl scale count 0 -a worldcup-backend
```

```powershell
# Nuclear — delete the app entirely
flyctl apps destroy worldcup-backend --yes
```

Either takes effect within seconds and stops new charges. You can redeploy later.

---

## 7 · Git / GitHub (pushing changes)

### Commit and push from the project root

```powershell
cd C:\Users\benat\OneDrive\Documents\GitHub\WorldCup
git status               # see what's changed
git add -A               # stage everything
git commit -m "Short description of what I changed"
git push                 # push to GitHub
```

Pushing to GitHub triggers a Vercel redeploy automatically (frontend only). Backend redeploys via `flyctl deploy` manually.

---

## 8 · Handy one-liners

### Restart the backend (after editing Python files)

```powershell
# Find PID, kill it, restart
$pid = (netstat -ano | Select-String ":8000.*LISTENING").ToString().Split()[-1]
Stop-Process -Id $pid -Force
cd C:\Users\benat\OneDrive\Documents\GitHub\WorldCup\backend
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The dev backend doesn't auto-reload by default. Stop it (Ctrl+C in its window) and start again to pick up code changes.

### Check the schema of a table in the local SQLite DB

```powershell
cd C:\Users\benat\OneDrive\Documents\GitHub\WorldCup\backend
python -c "import sqlite3; c=sqlite3.connect('worldcup.db'); [print(r) for r in c.execute('PRAGMA table_info(competitors)')]"
```

Replace `competitors` with any table name. Useful when adding columns.

### Force re-init the DB schema (without losing your xlsx data)

```powershell
cd C:\Users\benat\OneDrive\Documents\GitHub\WorldCup\backend
python -c "import asyncio; from app.db.connection import init_db; asyncio.run(init_db())"
```

Runs `CREATE TABLE IF NOT EXISTS` for the latest schema. Won't add columns to existing tables — for that, delete the DB and re-seed.

---

## When things break

If a command fails and the error message isn't obvious:
1. Copy the **full output** of the command (right-click in PowerShell → Copy)
2. Note **what you were trying to do**
3. Paste it into a chat with me — I'll diagnose
