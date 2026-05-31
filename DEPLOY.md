# Deploying the World Cup site

Three pieces, three services:

| Piece            | Host       | Cost              |
|------------------|------------|-------------------|
| Database (libSQL) | **Turso**  | Free (500 MB)     |
| Backend (FastAPI) | **Fly.io** | Free (3 small VMs) |
| Frontend (Next.js) | **Vercel** | Free (hobby plan) |

End result: your site at `https://<your-app>.vercel.app`. Optional custom domain ~$12/year via Cloudflare or Namecheap.

---

## Prerequisites

- A **GitHub** account with this repo pushed up (you already have it under `OneDrive/Documents/GitHub/WorldCup`).
- A **Vercel** account (you have this).
- A new account each for **Turso** and **Fly.io** — free, sign up with GitHub for speed.
- `flyctl` CLI installed — see step 3.

---

## Part 1 · Set up the database (Turso)

1. Go to **<https://turso.tech>** → Sign up (use GitHub).
2. In the dashboard, click **Create Database**. Pick:
   - **Name**: `worldcup` (anything you want)
   - **Group**: the default (closest region to you)
3. After creation you'll see two values you need to save:
   - **Database URL** — looks like `libsql://worldcup-yourname.aws-us-east-1.turso.io`
   - **Auth Token** — click "Generate Token" → "Read & Write" → "Never expire" → copy the long `eyJ...` string

   **Keep both safe — the token is a password.**

---

## Part 2 · Seed your data into Turso

The seeder already supports Turso — it reads `TURSO_URL` + `TURSO_TOKEN` from env. Run it locally pointed at your fresh cloud DB:

```powershell
# In PowerShell, from the project root
cd C:\Users\benat\OneDrive\Documents\GitHub\WorldCup\backend

# Set env vars FOR THIS SHELL ONLY (won't persist)
$env:TURSO_URL  = "libsql://worldcup-yourname.aws-us-east-1.turso.io"
$env:TURSO_TOKEN = "eyJ...your-long-token..."

# Make sure Excel doesn't have worldcup.xlsx open, then:
python -m scripts.seed_from_xlsx
```

You should see the familiar output:
```
teams        -> 48 inserted
venues       -> 16 inserted
players      -> 1248 inserted (0 skipped)
matches      -> 104 inserted (0 skipped)
...
```

Sanity check from the Turso dashboard → Browse → run `SELECT COUNT(*) FROM teams;` (should return 48).

**You only do this once.** Future roster updates re-run the same command (just before tournament starts) or via the per-row admin UI once it's live.

---

## Part 3 · Deploy the backend to Fly.io

### 3a. Install the Fly CLI

In PowerShell (as your normal user):

```powershell
iwr https://fly.io/install.ps1 -useb | iex
```

Restart your shell so `flyctl` is on PATH, then:

```powershell
flyctl auth signup    # or: flyctl auth login   if you already have an account
```

### 3b. Create the app

```powershell
cd C:\Users\benat\OneDrive\Documents\GitHub\WorldCup\backend
flyctl apps create worldcup-backend     # pick your own globally-unique name
```

Open [`backend/fly.toml`](backend/fly.toml) and **change the `app =` line** to match the name you picked. While you're there, set `primary_region` to a code near you ([list of regions](https://fly.io/docs/reference/regions/)) — `iad` for US East, `lhr` for London, `syd` for Sydney, etc.

### 3c. Push your secrets

```powershell
flyctl secrets set `
  TURSO_URL="libsql://worldcup-yourname.aws-us-east-1.turso.io" `
  TURSO_TOKEN="eyJ...your-long-token..." `
  SYNC_SECRET="Rosie" `
  ALLOWED_ORIGINS="https://worldcup.vercel.app"
```

> **Note** — you don't know your Vercel URL yet. Use a placeholder for now and come back to update it after Part 4.

### 3d. Deploy

```powershell
flyctl deploy
```

First deploy takes 2–4 minutes (Docker build + image push). On success Fly prints your URL — looks like `https://worldcup-backend.fly.dev`.

### 3e. Verify

```powershell
curl.exe https://worldcup-backend.fly.dev/api/health
# {"status":"ok"}

curl.exe https://worldcup-backend.fly.dev/api/groups
# [{"group_name":"A","rows":[...]}]
```

(Use `curl.exe` — not just `curl` — to invoke the real curl binary. The bare `curl` in PowerShell is an alias for `Invoke-WebRequest`, which throws a security prompt on every call.)

If the second one returns groups, the backend is reading from Turso. ✓

---

## Part 4 · Deploy the frontend to Vercel

### 4a. Push your code

Make sure your latest local changes are pushed to GitHub:

```powershell
cd C:\Users\benat\OneDrive\Documents\GitHub\WorldCup
git status
git add -A
git commit -m "Production deployment config"
git push
```

### 4b. Import to Vercel

1. <https://vercel.com/new> → **Import** your `WorldCup` repo.
2. **Framework Preset**: Next.js (auto-detected). ✓
3. **Root Directory**: click **Edit** → `frontend`. ⚠ Critical — your Next.js app isn't at the repo root.
4. **Environment Variables** — add one:
   - Name: `NEXT_PUBLIC_API_URL`
   - Value: `https://worldcup-backend.fly.dev`  *(your Fly URL from Part 3d)*
   - Apply to: Production, Preview, Development
5. Click **Deploy**.

First build takes ~2 min. When done you'll get a URL like `https://worldcup-yourname.vercel.app`.

### 4c. Tell the backend to trust the new domain

Vercel just gave you the real frontend URL — go update Fly's CORS:

```powershell
cd C:\Users\benat\OneDrive\Documents\GitHub\WorldCup\backend
flyctl secrets set ALLOWED_ORIGINS="https://worldcup-yourname.vercel.app"
```

This redeploys the backend automatically (~30s).

---

## Part 5 · Verify end-to-end

Open your Vercel URL in a browser. You should see:

- ✅ The hero with WORLD CUP 2026
- ✅ Group standings populated
- ✅ Fixture cards with real team names
- ✅ Nav links work: Groups, Bracket, Stats, Pool

Visit `/admin` → enter `Rosie` (or whatever you set `SYNC_SECRET` to) → you should see the match list.

If the page loads but data is empty, open DevTools → Network and check what's happening on the `/api/...` requests. Common issues:
- **CORS error** → `ALLOWED_ORIGINS` doesn't match your Vercel URL exactly. Get the exact URL from Vercel.
- **404 / "Not found"** → `NEXT_PUBLIC_API_URL` on Vercel is wrong. Re-check spelling.
- **500 / blank data** → Fly logs: `flyctl logs -a worldcup-backend`

---

## Day-to-day after launch

### Roster updates

> ⚠ Once family members start making picks, **don't re-run `seed_from_xlsx`** — it wipes player IDs and breaks their picks. Either finish all roster edits before opening signups, or ask me to add the `--update-rosters-only` mode.

### Updating scores during a match

Visit `https://your-site.vercel.app/admin/match/<id>` from your phone/laptop. Enter scores, events, lineups, stats. They flow live to everyone via the 60s SWR refresh.

### Tweaking scoring rules

`/admin/scoring` — change point values. Every finalised match is automatically re-scored.

### Pushing code changes

- Frontend: just `git push` → Vercel auto-deploys.
- Backend: `cd backend && flyctl deploy` from your laptop.

### Viewing logs

- Backend logs: `flyctl logs -a worldcup-backend`
- Frontend / build logs: Vercel dashboard → Deployments → click any deployment

### Custom domain (optional)

In Vercel: **Settings → Domains → Add**. Vercel walks you through the DNS records. Then update the backend CORS:

```powershell
flyctl secrets set ALLOWED_ORIGINS="https://worldcup.example.com,https://worldcup-yourname.vercel.app"
```

---

## Cost summary

If you stay under free-tier limits (family-only traffic, this should be easy):

| Service | Free limit | Family use likely cost |
|---|---|---|
| Turso | 500 MB storage, 1B row reads/month | $0 |
| Fly.io | 3 shared-cpu-1x machines, 160GB outbound/mo | $0 |
| Vercel Hobby | 100 GB bandwidth/mo, unlimited deployments | $0 |
| **Total** | | **$0/month** |

The only thing you might pay for is a custom domain (~$12/year).

---

## Help / troubleshooting

If something breaks, capture:
- The Vercel deployment URL
- The Fly app URL
- Any error message from the browser console
- Output of `flyctl logs -a worldcup-backend`

…and paste it back to me, I'll debug.
