'use client'

import { use } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import { useMatch, useMatchPicks } from '@/lib/hooks'
import { MatchDetail, MatchPicksResponse, MatchPickRow } from '@/lib/types'
import { displayScore, formatKickoff, stageName } from '@/lib/utils'

export default function MatchPicksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: matchDetail }   = useMatch(id)
  const { data: matchPicksData, error: matchPicksError, isLoading } = useMatchPicks(id)

  if (isLoading) return <Skeleton />

  // Backend returns 403 pre-kickoff — present a friendly message
  const locked = matchPicksError ||
                 (matchPicksData && (matchPicksData as any).detail) ||
                 false

  if (locked) {
    return (
      <div className="space-y-8 mx-auto max-w-xl">
        <BackLink />
        <section className="rounded-3xl border border-dashed border-white/15 panel p-10 text-center">
          <div className="text-3xl">🔒</div>
          <h1 className="mt-3 font-display text-2xl tracking-wide text-cream">Picks are hidden</h1>
          <p className="mt-2 text-sm text-cream/50">
            Everyone&rsquo;s picks for this match unlock once it kicks off.
          </p>
        </section>
      </div>
    )
  }

  const data: MatchPicksResponse | undefined = matchPicksData as MatchPicksResponse | undefined
  const m = data?.match
  const picks = data?.picks ?? []
  const md: MatchDetail | undefined = matchDetail

  return (
    <div className="space-y-8">
      <BackLink />

      {/* Match header */}
      {md?.match && (
        <section className="relative overflow-hidden rounded-3xl border border-white/10 panel">
          <div className="absolute inset-0 opacity-50">
            <div className="absolute -top-32 left-1/4 h-72 w-72 rounded-full bg-amber-500/20 blur-3xl" />
          </div>
          <div className="relative px-6 py-8 sm:px-10">
            <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">
              {stageName(md.match.stage).toUpperCase()}{md.match.group_name ? ` · GROUP ${md.match.group_name}` : ''}
            </div>
            <h1 className="mt-1 font-display text-3xl tracking-tight text-cream sm:text-4xl">
              {md.match.home_team?.name?.toUpperCase() ?? 'TBD'}
              <span className="mx-3 text-cream/30">VS</span>
              {md.match.away_team?.name?.toUpperCase() ?? 'TBD'}
            </h1>
            {(() => {
              const { home, away, suffix } = displayScore(md.match)
              if (home === null || away === null) return null
              return (
                <div className="mt-3 flex items-baseline gap-3">
                  <span className="font-display text-5xl tabular-nums text-cream">
                    {home}<span className="mx-2 text-cream/30">–</span>{away}
                  </span>
                  {suffix && (
                    <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-bold tracking-widest text-amber-400">
                      {suffix.toUpperCase()}
                    </span>
                  )}
                </div>
              )
            })()}
            <div className="mt-2 text-xs text-cream/40">
              {formatKickoff(md.match.scheduled_at)}
            </div>
          </div>
        </section>
      )}

      {/* Per-competitor picks */}
      <section>
        <div className="mb-5 flex items-end justify-between">
          <div>
            <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">FAMILY PICKS</div>
            <h2 className="font-display text-2xl tracking-wide text-cream sm:text-3xl">Everyone&rsquo;s Predictions</h2>
          </div>
          <span className="text-[10px] font-bold tracking-widest text-cream/40">
            {picks.length} {picks.length === 1 ? 'PICK' : 'PICKS'}
          </span>
        </div>

        {picks.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 panel py-10 text-center text-sm text-cream/40">
            Nobody made a pick on this match.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-white/10 panel">
            <div className="hidden sm:grid grid-cols-[40px_1fr_1fr_100px_1fr_60px_70px] items-center gap-2 border-b border-white/5 bg-black/30 px-4 py-2.5 text-[10px] font-bold tracking-widest text-cream/40">
              <span className="text-center">RANK</span>
              <span>TEAM</span>
              <span>MANAGER</span>
              <span className="text-center">PICK</span>
              <span>1ST SCORER</span>
              <span className="text-center">JOKER</span>
              <span className="text-center text-gold">POINTS</span>
            </div>

            <div className="divide-y divide-white/5">
              {picks.map((p, i) => <PickRowItem key={p.competitor_id} pick={p} rank={i + 1} />)}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function PickRowItem({ pick, rank }: { pick: MatchPickRow; rank: number }) {
  const pts = pick.points_awarded
  const top = rank <= 3 && pts !== null

  return (
    <Link
      href={`/compete/${pick.competitor_id}`}
      className="grid grid-cols-[40px_1fr_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.04] sm:grid-cols-[40px_1fr_1fr_100px_1fr_60px_70px]"
    >
      {/* Rank */}
      <span className={clsx(
        'inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold tabular-nums',
        rank === 1 && top ? 'bg-gold text-ink' :
        rank === 2 && top ? 'bg-amber-500/30 text-amber-400' :
        rank === 3 && top ? 'bg-amber-600/30 text-amber-400' :
        'text-cream/40'
      )}>{rank}</span>

      {/* Team — uses minimal column on mobile */}
      <div className="min-w-0">
        <div className="truncate font-display text-sm tracking-wider text-cream">
          {pick.team_name.toUpperCase()}
        </div>
        <div className="sm:hidden truncate text-[11px] text-cream/40">
          {pick.competitor_name} · {pick.home_score}–{pick.away_score} · {pick.no_goal === 1 ? 'No goal' : (pick.first_scorer_name ?? 'No scorer pick')} {pick.is_joker === 1 ? ' · JOKER' : ''} {pts !== null ? ` · ${pts} pts` : ''}
        </div>
      </div>

      <span className="hidden truncate text-sm text-cream/60 sm:block">{pick.competitor_name}</span>

      <span className="hidden text-center font-display text-lg tabular-nums text-cream sm:block">
        {pick.home_score}<span className="text-cream/30">–</span>{pick.away_score}
      </span>

      <span className="hidden truncate text-sm text-cream/70 sm:block">
        {pick.no_goal === 1
          ? <em className="text-cream/50">No goal scored</em>
          : (pick.first_scorer_name ?? <span className="text-cream/30">—</span>)}
      </span>

      <span className="hidden text-center sm:block">
        {pick.is_joker === 1 ? (
          <span className="inline-block rounded-full bg-amber-500/20 px-2 py-0.5 text-[9px] font-bold text-amber-400">×{2}</span>
        ) : <span className="text-cream/20">—</span>}
      </span>

      <span className={clsx(
        'hidden text-center font-display text-xl tabular-nums sm:block',
        pts === null ? 'text-cream/25' :
        pts === 0   ? 'text-cream/40' :
        pts >= 10   ? 'text-gold-gradient' :
        pts >= 5    ? 'text-amber-400' :
                       'text-cream'
      )}>
        {pts ?? '–'}
      </span>

      <span className="text-cream/30 sm:hidden">→</span>
    </Link>
  )
}

function BackLink() {
  return (
    <Link
      href="/compete"
      className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-cream/60 hover:border-amber-400/30 hover:text-gold"
    >
      ← Leaderboard
    </Link>
  )
}

function Skeleton() {
  return (
    <div className="space-y-8">
      <div className="h-7 w-32 rounded-full shimmer" />
      <div className="h-40 rounded-3xl shimmer" />
      <div className="h-72 rounded-2xl shimmer" />
    </div>
  )
}
