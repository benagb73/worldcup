'use client'

import { use, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import clsx from 'clsx'
import { useCompetitor, useCompetitorPicks, useAllRosters, useScoringConfig, useCompetitorPools } from '@/lib/hooks'
import { PoolMembership } from '@/lib/types'
import { CompetitorDetail, PickRow, ScoringConfig } from '@/lib/types'
import { competeFetch, CompeteError, BUCKET_LABEL, isOwner, markAsOwner } from '@/lib/compete'
import { formatKickoff, stageName } from '@/lib/utils'

export default function CompetitorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const numericId = Number(id)
  const [owner, setOwner] = useState(false)
  useEffect(() => { setOwner(isOwner(numericId)) }, [numericId])

  const { data: comp,    isLoading: lc, mutate: mutateComp }   = useCompetitor(id)
  const { data: picks,   isLoading: lp, mutate: mutatePicks }  = useCompetitorPicks(id)
  const { data: scoring }                                        = useScoringConfig()
  // One batch fetch of every team's roster — way faster than 48 per-team requests
  const { data: rosters } = useAllRosters()
  // Which pools this competitor is in
  const { data: pools } = useCompetitorPools(id)

  if (lc || lp) return <Skeleton />
  if (!comp)    return <div className="py-20 text-center text-cream/40">Competitor not found</div>

  const detail: CompetitorDetail = comp
  const rows:   PickRow[]        = picks ?? []

  function claim() {
    markAsOwner(numericId)
    setOwner(true)
    // Re-fetch picks so server returns hidden picks
    mutatePicks()
  }

  // Active = future kickoff with status='scheduled'; closed = the rest
  const now = Date.now()
  const isLocked = (m: PickRow) =>
    m.status !== 'scheduled' || new Date(m.scheduled_at).getTime() <= now

  const active = rows.filter(r => !isLocked(r))
                     .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
  const closed = rows.filter(r =>  isLocked(r))
                     .sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at))

  async function refresh() {
    await Promise.all([mutateComp(), mutatePicks()])
  }

  return (
    <div className="space-y-10">
      <Link
        href="/compete"
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-cream/60 hover:border-amber-400/30 hover:text-gold"
      >
        ← Leaderboard
      </Link>

      <Hero detail={detail} />

      <JoinedPools pools={(pools as PoolMembership[] | undefined) ?? []} owner={owner} />

      {!owner && (
        <div className="rounded-2xl border border-amber-400/30 bg-amber-500/[0.04] px-5 py-4 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-cream/80">
            <span className="font-bold text-amber-400">Is this your team?</span>{' '}
            Claim it on this browser to view and edit your open picks. Other people will only see your picks once a match kicks off.
          </div>
          <button
            onClick={claim}
            className="rounded-lg bg-gold-gradient px-4 py-2 text-xs font-bold tracking-widest text-ink shadow-gold transition-transform hover:scale-105"
          >
            CLAIM AS MINE
          </button>
        </div>
      )}

      {/* Open picks — only visible to the owner */}
      {owner ? (
        <section>
          <SectionHeading
            eyebrow="OPEN"
            title="Make Your Picks"
            subtitle={`${active.length} match${active.length === 1 ? '' : 'es'} still open · picks lock at kickoff`}
          />
          {active.length === 0 ? (
            <EmptyBlock>All matches are locked or finished. Wait for the next round!</EmptyBlock>
          ) : (
            <div className="space-y-4">
              {active.map(p => (
                <PickCard
                  key={p.match_id}
                  pick={p}
                  competitorId={detail.id}
                  detail={detail}
                  scoring={scoring as ScoringConfig | undefined}
                  rosters={rosters as Record<string, any[]> | undefined}
                  onSaved={refresh}
                />
              ))}
            </div>
          )}
        </section>
      ) : (
        <section>
          <SectionHeading
            eyebrow="OPEN"
            title="Open Matches"
            subtitle={`${active.length} match${active.length === 1 ? '' : 'es'} still open — picks are hidden until kickoff`}
          />
          <EmptyBlock>
            {detail.team_name}&rsquo;s picks for upcoming matches will appear publicly once each match kicks off.
          </EmptyBlock>
        </section>
      )}

      {/* Locked picks */}
      {closed.length > 0 && (
        <section>
          <SectionHeading
            eyebrow="LOCKED"
            title="Past Picks & Results"
          />
          <div className="space-y-3">
            {closed.map(p => <LockedPickCard key={p.match_id} pick={p} />)}
          </div>
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function Hero({ detail }: { detail: CompetitorDetail }) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/10 panel">
      <div className="absolute inset-0 opacity-50">
        <div className="absolute -top-32 -left-32 h-72 w-72 rounded-full bg-amber-500/20 blur-3xl" />
      </div>
      <div className="relative px-6 py-8 sm:px-10 sm:py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">PICKS PAGE</div>
            <h1 className="mt-1 font-display text-4xl tracking-wide text-cream sm:text-5xl">
              {detail.team_name.toUpperCase()}
            </h1>
            <div className="mt-2 text-sm text-cream/50">Managed by {detail.name}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">TOTAL POINTS</div>
            <div className="font-display text-6xl tracking-tight text-gold-gradient">{detail.total_points}</div>
          </div>
        </div>
      </div>

    </section>
  )
}

// ---------------------------------------------------------------------------
// Open pick card — editable
// ---------------------------------------------------------------------------

function PickCard({ pick, competitorId, detail, scoring, rosters, onSaved }: {
  pick: PickRow
  competitorId: number
  detail: CompetitorDetail
  scoring?: ScoringConfig
  rosters?: Record<string, Array<{ id: number; name: string; shirt_number: number | null; position: string | null }>>
  onSaved: () => Promise<void>
}) {
  // Local draft state
  const [home, setHome] = useState<number>(pick.pick_home ?? 0)
  const [away, setAway] = useState<number>(pick.pick_away ?? 0)
  const [scorer, setScorer] = useState<number | 'none' | ''>(
    pick.no_goal === 1 ? 'none' : (pick.first_scorer_player_id ?? '')
  )
  const [joker, setJoker] = useState<boolean>(pick.is_joker === 1)
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  // Reset when upstream changes (e.g. after save)
  useEffect(() => {
    setHome(pick.pick_home ?? 0)
    setAway(pick.pick_away ?? 0)
    setScorer(pick.no_goal === 1 ? 'none' : (pick.first_scorer_player_id ?? ''))
    setJoker(pick.is_joker === 1)
  }, [pick.pick_home, pick.pick_away, pick.first_scorer_player_id, pick.no_goal, pick.is_joker])

  const homeRoster = pick.home_id != null ? rosters?.[String(pick.home_id)] : undefined
  const awayRoster = pick.away_id != null ? rosters?.[String(pick.away_id)] : undefined

  const bucket = pick.joker_bucket
  const cap    = detail.joker_caps[bucket] ?? 0
  const used   = detail.jokers_used[bucket] ?? 0
  // If THIS match's pick is already a joker, that counts in `used` — subtract it back out
  const usedExcluding = used - (pick.is_joker === 1 ? 1 : 0)
  const jokerDisabled = cap === 0 || (usedExcluding >= cap && !pick.is_joker)

  async function save() {
    setBusy(true)
    setErr(null)
    try {
      await competeFetch(`/competitors/${competitorId}/picks/${pick.match_id}`, {
        method: 'PUT',
        body: JSON.stringify({
          home_score: home,
          away_score: away,
          first_scorer_player_id: scorer === 'none' || scorer === '' ? null : Number(scorer),
          no_goal:  scorer === 'none',
          is_joker: joker,
        }),
      })
      setFlash('Saved ✓')
      setTimeout(() => setFlash(null), 1500)
      await onSaved()
    } catch (e) {
      setErr(e instanceof CompeteError ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={clsx(
      'rounded-2xl border panel p-5',
      joker ? 'border-amber-400/40 bg-amber-500/[0.04] shadow-gold'
            : 'border-white/10'
    )}>
      {/* Meta strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold tracking-widest">
        <span className="flex items-center gap-2 text-cream/40">
          <span>{stageName(pick.stage).toUpperCase()}{pick.group_name ? ` · ${pick.group_name}` : ''}</span>
          <span className="text-cream/30">·</span>
          <span className="text-amber-400">{formatKickoff(pick.scheduled_at).toUpperCase()}</span>
        </span>
        <span className="rounded-full bg-white/5 px-2 py-0.5 text-[9px] text-cream/40">
          {BUCKET_LABEL[bucket]?.toUpperCase() ?? bucket.toUpperCase()}
        </span>
      </div>

      {/* Score inputs — stack vertically on mobile so team names + flags get
          full row width; horizontal 3-column layout from sm+ upward. */}
      <div className="mt-4">
        {/* Mobile: teams in a 2-col row on top */}
        <div className="grid grid-cols-2 gap-3 sm:hidden">
          <TeamSide team={{ id: pick.home_id, name: pick.home_name, code: pick.home_code, flag: pick.home_flag }} align="left" />
          <TeamSide team={{ id: pick.away_id, name: pick.away_name, code: pick.away_code, flag: pick.away_flag }} align="right" />
        </div>
        {/* Mobile: score steppers under the teams */}
        <div className="mt-3 grid grid-cols-2 items-center gap-3 sm:hidden">
          <div className="flex items-center justify-center gap-1.5">
            <NumStepper value={home} onChange={setHome} />
          </div>
          <div className="flex items-center justify-center gap-1.5">
            <NumStepper value={away} onChange={setAway} />
          </div>
        </div>

        {/* Desktop: classic 3-column horizontal */}
        <div className="hidden grid-cols-[1fr_auto_1fr] items-center gap-3 sm:grid">
          <TeamSide team={{ id: pick.home_id, name: pick.home_name, code: pick.home_code, flag: pick.home_flag }} align="right" />
          <div className="flex items-center justify-center gap-1.5">
            <NumStepper value={home} onChange={setHome} />
            <span className="font-display text-2xl text-cream/30">:</span>
            <NumStepper value={away} onChange={setAway} />
          </div>
          <TeamSide team={{ id: pick.away_id, name: pick.away_name, code: pick.away_code, flag: pick.away_flag }} align="left" />
        </div>
      </div>

      {/* First scorer */}
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="block text-[10px] font-bold tracking-widest text-cream/40 mb-1">FIRST SCORER</span>
          <select
            value={scorer}
            onChange={e => {
              const v = e.target.value
              setScorer(v === '' || v === 'none' ? (v as any) : Number(v))
            }}
            className="adm-input"
          >
            <option value="">— pick a player —</option>
            <option value="none">No goal scored (0–0)</option>
            {homeRoster && (
              <optgroup label={pick.home_code ?? 'Home'}>
                {homeRoster.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.shirt_number ? `#${p.shirt_number} ` : ''}{p.name}{p.position ? ` (${p.position})` : ''}
                  </option>
                ))}
              </optgroup>
            )}
            {awayRoster && (
              <optgroup label={pick.away_code ?? 'Away'}>
                {awayRoster.map((p: any) => (
                  <option key={p.id} value={p.id}>
                    {p.shirt_number ? `#${p.shirt_number} ` : ''}{p.name}{p.position ? ` (${p.position})` : ''}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>

        {/* Joker toggle */}
        <div className="flex items-end">
          <label className={clsx(
            'flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold tracking-widest sm:w-auto',
            jokerDisabled && !joker ? 'cursor-not-allowed border-white/5 text-cream/30'
            : joker ? 'border-amber-400/40 bg-amber-500/10 text-amber-400 cursor-pointer'
            : 'border-white/10 text-cream/60 hover:border-amber-400/30 cursor-pointer'
          )}>
            <input
              type="checkbox"
              checked={joker}
              disabled={jokerDisabled && !joker}
              onChange={e => setJoker(e.target.checked)}
              className="accent-amber-400"
            />
            {joker ? 'JOKER ON ×2' : 'PLAY JOKER (×' + (scoring?.joker_multiplier ?? 2) + ')'}
          </label>
        </div>
      </div>

      {jokerDisabled && !joker && cap > 0 && (
        <div className="mt-2 text-[10px] text-cream/40">
          No jokers left for {BUCKET_LABEL[bucket]?.toLowerCase() ?? bucket}.
        </div>
      )}

      {err && <div className="mt-3 text-xs text-live">{err}</div>}

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-[10px] text-cream/40">
          {flash ?? (pick.pick_id ? 'You can update this pick until kickoff.' : 'No pick saved yet.')}
        </span>
        <button
          onClick={save}
          disabled={busy || (scorer === '')}
          className="rounded-lg bg-gold-gradient px-4 py-2 text-xs font-bold tracking-widest text-ink shadow-gold disabled:opacity-50"
        >
          {busy ? 'SAVING…' : pick.pick_id ? 'UPDATE PICK' : 'SAVE PICK'}
        </button>
      </div>

      <style jsx>{`
        :global(.adm-input) {
          width: 100%;
          background: rgba(0,0,0,0.3);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          padding: 8px 10px;
          color: #f7f5ef;
          font-size: 13px;
        }
        :global(.adm-input:focus) {
          outline: none;
          border-color: rgba(251,191,36,0.5);
        }
      `}</style>
    </div>
  )
}

function NumStepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onChange(Math.max(0, value - 1))}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-cream/60 hover:border-live/40 hover:text-live"
      >−</button>
      <input
        type="number" min={0} max={20}
        value={value}
        onChange={e => onChange(Math.max(0, Math.min(20, Number(e.target.value || 0))))}
        className="w-14 rounded-lg border border-white/10 bg-black/30 px-1 py-1.5 text-center font-display text-2xl tabular-nums text-cream focus:border-amber-400/50 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => onChange(Math.min(20, value + 1))}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-cream/60 hover:border-amber-400/50 hover:text-amber-400"
      >+</button>
    </div>
  )
}

function TeamSide({ team, align }: {
  team: { id: number | null; name: string | null; code: string | null; flag: string | null }
  align: 'left' | 'right'
}) {
  if (!team.id) {
    return (
      <div className={clsx('flex items-center gap-2 min-w-0', align === 'right' ? 'justify-end' : '')}>
        <span className="text-sm italic text-cream/30">TBD</span>
      </div>
    )
  }
  const flag = team.flag ? (
    <Image src={team.flag} alt={team.code ?? ''} width={28} height={20}
      className="h-5 w-7 shrink-0 rounded-sm object-cover ring-1 ring-black/40" unoptimized />
  ) : (
    <span className="h-5 w-7 shrink-0 rounded-sm bg-white/10 ring-1 ring-black/40" />
  )
  const label = (
    <div className={clsx('min-w-0', align === 'right' ? 'text-right' : '')}>
      <div className="truncate text-sm font-bold text-cream">{team.name}</div>
      <div className="font-mono text-[10px] tracking-widest text-cream/40">{team.code}</div>
    </div>
  )
  return (
    <div className={clsx('flex items-center gap-2 min-w-0', align === 'right' ? 'justify-end' : '')}>
      {align === 'left' && flag}
      {label}
      {align === 'right' && flag}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Locked pick card — read-only with actual result + points
// ---------------------------------------------------------------------------

function LockedPickCard({ pick }: { pick: PickRow }) {
  const actualHome = pick.et_home ?? pick.ft_home
  const actualAway = pick.et_away ?? pick.ft_away
  const isFinal = pick.status === 'final'
  const isLive  = pick.status.startsWith('live')

  const pts = pick.points_awarded
  const hasPick = pick.pick_id !== null

  return (
    <div className={clsx(
      'rounded-xl border panel p-4',
      pick.is_joker ? 'border-amber-400/30 bg-amber-500/[0.03]' : 'border-white/10'
    )}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold tracking-widest">
        <span className="text-cream/40">
          {stageName(pick.stage).toUpperCase()}{pick.group_name ? ` · ${pick.group_name}` : ''}
          {' · '}{formatKickoff(pick.scheduled_at).toUpperCase()}
        </span>
        {pick.is_joker === 1 && (
          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-amber-400">JOKER ×</span>
        )}
      </div>

      <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="text-right text-sm font-semibold text-cream/80 truncate">
          {pick.home_name ?? 'TBD'} <span className="text-[10px] text-cream/40">{pick.home_code ?? ''}</span>
        </div>
        <div className="flex flex-col items-center">
          {isFinal || isLive ? (
            <div className="font-display text-2xl tabular-nums text-cream">
              {actualHome ?? '–'}<span className="text-cream/30">–</span>{actualAway ?? '–'}
            </div>
          ) : (
            <span className="text-xs text-cream/30 font-bold tracking-widest">{pick.status.toUpperCase()}</span>
          )}
          <span className="mt-0.5 text-[9px] tracking-widest text-cream/30">ACTUAL</span>
        </div>
        <div className="text-left text-sm font-semibold text-cream/80 truncate">
          <span className="text-[10px] text-cream/40">{pick.away_code ?? ''}</span> {pick.away_name ?? 'TBD'}
        </div>
      </div>

      {hasPick && (
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3 border-t border-white/5 pt-3">
          <div className="text-right text-sm text-cream/60">Your pick</div>
          <div className="font-display text-lg tabular-nums text-cream/80">
            {pick.pick_home}<span className="text-cream/30">–</span>{pick.pick_away}
          </div>
          <div className="text-left text-xs text-cream/50">
            {pick.no_goal === 1 ? 'No goal scored' : (pick.first_scorer_name ?? '—')}
          </div>
        </div>
      )}

      {isFinal && hasPick && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/5 pt-3">
          <Link
            href={`/compete/match/${pick.match_id}`}
            className="text-[10px] font-bold tracking-widest text-amber-400/80 hover:text-amber-400"
          >
            ALL FAMILY PICKS →
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold tracking-widest text-cream/40">POINTS</span>
            <span className={clsx(
              'font-display text-xl tabular-nums',
              (pts ?? 0) === 0 ? 'text-cream/30' :
              (pts ?? 0) >= 5 ? 'text-amber-400' :
              'text-cream'
            )}>
              {pts ?? 0}
            </span>
          </div>
        </div>
      )}

      {!hasPick && (
        <div className="mt-3 border-t border-white/5 pt-3 text-center text-xs italic text-cream/30">
          No pick was made for this match.
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SectionHeading({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">{eyebrow}</div>
      <h2 className="font-display text-2xl tracking-wide text-cream sm:text-3xl">{title}</h2>
      {subtitle && <p className="mt-1 text-sm text-cream/40">{subtitle}</p>}
    </div>
  )
}

function EmptyBlock({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 panel py-10 text-center text-sm text-cream/50">
      {children}
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-8">
      <div className="h-7 w-32 rounded-full shimmer" />
      <div className="h-48 rounded-3xl shimmer" />
      <div className="h-32 rounded-2xl shimmer" />
      <div className="h-32 rounded-2xl shimmer" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Joined-pools summary + "Join another" form
// ---------------------------------------------------------------------------

function JoinedPools({ pools, owner }: { pools: PoolMembership[]; owner: boolean }) {
  if (!pools.length && !owner) return null
  return (
    <section className="rounded-2xl border border-white/10 panel p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">JOINED POOLS</div>
          <h2 className="font-display text-xl tracking-wide text-cream">
            {pools.length === 0
              ? 'Not in any pools yet'
              : pools.length === 1 ? '1 pool' : `${pools.length} pools`}
          </h2>
        </div>
        {owner && (
          <Link
            href="/compete"
            className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-bold tracking-widest text-amber-400 hover:bg-amber-500/20"
          >
            + JOIN ANOTHER
          </Link>
        )}
      </div>

      {pools.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {pools.map(p => (
            <Link
              key={p.id}
              href={`/pool/${p.slug}`}
              className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-bold text-cream/70 hover:border-amber-400/40 hover:text-cream"
            >
              {p.name}
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
