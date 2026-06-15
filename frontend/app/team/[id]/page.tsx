'use client'

import { use } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import clsx from 'clsx'
import { useTeam } from '@/lib/hooks'
import { TeamDetail, PlayerTournamentTotals, MatchSummary } from '@/lib/types'
import { MatchCard } from '@/components/MatchCard'

const POS_ORDER = ['GK', 'DEF', 'MID', 'FWD'] as const
const POS_LABELS: Record<string, string> = {
  GK:  'Goalkeepers',
  DEF: 'Defenders',
  MID: 'Midfielders',
  FWD: 'Forwards',
}
const POS_TINT: Record<string, string> = {
  GK:  'border-amber-400/30 text-amber-400',
  DEF: 'border-blue-400/30 text-blue-400',
  MID: 'border-emerald-400/30 text-emerald-400',
  FWD: 'border-rose-400/30 text-rose-400',
}

export default function TeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data, isLoading } = useTeam(id)

  if (isLoading) return <Skeleton />
  if (!data) return <div className="py-20 text-center text-cream/40">Team not found</div>

  const detail: TeamDetail = data
  const { team, standing, fixtures, squad } = detail

  // Bucket squad by position
  const buckets: Record<string, PlayerTournamentTotals[]> = { GK: [], DEF: [], MID: [], FWD: [], OTHER: [] }
  for (const p of squad) {
    const pos = (p.player.position ?? 'OTHER') as keyof typeof buckets
    ;(buckets[pos] ?? buckets.OTHER).push(p)
  }

  // Upcoming vs played split
  const played = fixtures.filter(m => m.status === 'final')
  const upcoming = fixtures.filter(m => m.status !== 'final' && !m.status.startsWith('live'))
  const live = fixtures.filter(m => m.status.startsWith('live'))

  return (
    <div className="space-y-10">
      <Link
        href="/"
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-cream/60 hover:border-amber-400/30 hover:text-gold"
      >
        ← Back
      </Link>

      <TeamHero team={team} standing={standing} />

      {live.length > 0 && (
        <section>
          <SectionHeading eyebrow="LIVE" title={live.length === 1 ? 'Match in Progress' : 'Matches in Progress'} />
          <div className="space-y-3">
            {live.map(m => <MatchCard key={m.id} match={m} />)}
          </div>
        </section>
      )}

      {upcoming.length > 0 && (
        <section>
          <SectionHeading eyebrow="UPCOMING" title="Schedule" />
          <div className="space-y-3">
            {upcoming.map(m => <MatchCard key={m.id} match={m} />)}
          </div>
        </section>
      )}

      {played.length > 0 && (
        <section>
          <SectionHeading eyebrow="RESULTS" title="Played" />
          <div className="space-y-3">
            {played.map(m => <MatchCard key={m.id} match={m} />)}
          </div>
        </section>
      )}

      <section>
        <SectionHeading eyebrow="SQUAD" title={`${squad.length} Players`} />
        <div className="space-y-6">
          {POS_ORDER.map(pos => {
            const list = buckets[pos]
            if (!list?.length) return null
            return <PositionGroup key={pos} pos={pos} players={list} />
          })}
          {buckets.OTHER.length > 0 && <PositionGroup pos="OTHER" players={buckets.OTHER} />}
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function TeamHero({ team, standing }: { team: TeamDetail['team']; standing: TeamDetail['standing'] }) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/10 panel">
      <div className="absolute inset-0 opacity-60">
        <div className="absolute -top-32 -left-32 h-72 w-72 rounded-full bg-amber-500/20 blur-3xl" />
        <div className="absolute -bottom-32 -right-20 h-72 w-72 rounded-full bg-navy-500/30 blur-3xl" />
      </div>

      <div className="relative px-6 py-10 sm:px-10 sm:py-12">
        <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
          {/* Flag */}
          <div className="relative h-24 w-32 shrink-0 sm:h-28 sm:w-40">
            {team.flag_url ? (
              <Image
                src={team.flag_url}
                alt={team.code}
                fill
                sizes="(min-width: 640px) 160px, 128px"
                className="rounded-xl object-cover shadow-2xl ring-2 ring-black/40"
                unoptimized
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded-xl bg-white/10 ring-2 ring-black/40">
                <span className="font-display text-2xl">{team.code}</span>
              </div>
            )}
            <div className="absolute -inset-2 -z-10 rounded-xl bg-amber-500/20 blur-xl" />
          </div>

          {/* Info */}
          <div className="flex-1 text-center sm:text-left">
            <div className="flex flex-wrap items-center justify-center gap-3 sm:justify-start">
              <span className="text-[10px] font-bold tracking-[0.3em] text-amber-400">
                {team.group_name ? `GROUP ${team.group_name}` : 'KNOCKOUT ROUND'}
              </span>
              {team.world_rank != null && (
                <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold tracking-widest text-amber-400">
                  FIFA #{team.world_rank}
                </span>
              )}
            </div>
            <h1 className="mt-1 font-display text-4xl leading-none tracking-wide text-cream sm:text-6xl">
              {team.name.toUpperCase()}
            </h1>
            {team.manager && (
              <div className="mt-2 text-sm sm:text-base text-cream/70">
                <span className="text-[10px] font-bold tracking-[0.3em] text-cream/40 mr-2">MANAGER</span>
                {team.manager}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Group standing strip */}
      {standing && (
        <div className="relative border-t border-white/5 bg-black/30 px-6 py-5 sm:px-10">
          <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400 mb-3">GROUP STANDING</div>
          <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
            <StatTile label="Played"   value={standing.played} />
            <StatTile label="Won"      value={standing.won}   accent={standing.won > 0} />
            <StatTile label="Drawn"    value={standing.drawn} />
            <StatTile label="Lost"     value={standing.lost}  danger={standing.lost > 0} />
            <StatTile label="GF"       value={standing.goals_for} />
            <StatTile label="GA"       value={standing.goals_against} />
            <StatTile label="GD"       value={(standing.goal_diff > 0 ? '+' : '') + standing.goal_diff} />
            <StatTile label="Points"   value={standing.points} accent />
          </div>
        </div>
      )}
    </section>
  )
}

function StatTile({ label, value, accent, danger }: {
  label: string; value: number | string; accent?: boolean; danger?: boolean
}) {
  return (
    <div className={clsx(
      'rounded-lg border p-2.5 text-center',
      accent ? 'border-amber-400/30 bg-amber-500/5' :
      danger ? 'border-live/20 bg-live/[0.04]' :
      'border-white/10 bg-white/[0.02]'
    )}>
      <div className={clsx(
        'font-display text-2xl leading-none tabular-nums',
        accent ? 'text-amber-400' : danger ? 'text-live/80' : 'text-cream'
      )}>
        {value}
      </div>
      <div className="mt-1 text-[9px] font-bold tracking-widest text-cream/40">{label.toUpperCase()}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Squad table grouped by position
// ---------------------------------------------------------------------------

function PositionGroup({ pos, players }: { pos: string; players: PlayerTournamentTotals[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 panel">
      <div className={clsx(
        'flex items-center justify-between border-b border-white/5 bg-black/30 px-4 py-2.5',
      )}>
        <div className="flex items-center gap-2">
          <span className={clsx(
            'rounded-md border bg-white/[0.03] px-2 py-0.5 font-mono text-[10px] font-bold tracking-widest',
            POS_TINT[pos] ?? 'border-white/10 text-cream/60'
          )}>
            {pos}
          </span>
          <span className="font-display text-sm tracking-wider text-cream">
            {(POS_LABELS[pos] ?? pos).toUpperCase()}
          </span>
        </div>
        <span className="text-[10px] font-bold tracking-widest text-cream/40">
          {players.length} {players.length === 1 ? 'PLAYER' : 'PLAYERS'}
        </span>
      </div>

      <div className="hidden sm:grid grid-cols-[40px_1fr_minmax(0,90px)_repeat(6,minmax(0,46px))] items-center gap-2 border-b border-white/5 bg-black/80 backdrop-blur sticky top-0 z-20 px-4 py-2 text-[10px] font-bold tracking-widest text-cream/40">
        <span className="text-center">#</span>
        <span>PLAYER</span>
        <span className="hidden md:block">CLUB</span>
        <span className="text-center">APP</span>
        <span className="text-center">MIN</span>
        <span className="text-center text-gold">{pos === 'GK' ? 'SV' : 'G'}</span>
        <span className="text-center text-emerald-400">A</span>
        <span className="text-center">YEL</span>
        <span className="text-center">RED</span>
      </div>

      <div className="divide-y divide-white/5">
        {players.map(p => <PlayerRow key={p.player.id} entry={p} isGK={pos === 'GK'} />)}
      </div>
    </div>
  )
}

function PlayerRow({ entry, isGK }: { entry: PlayerTournamentTotals; isGK: boolean }) {
  const p = entry.player
  const club = p.club?.name
    ?? (p.club_status === 'unattached' ? 'Free agent' : p.club_status === 'unknown' ? 'Unknown' : '—')

  // For GK rows, the "headline" stat is saves instead of goals
  const headline = isGK ? entry.saves : entry.goals
  const headlineHighlight = headline > 0

  return (
    <Link
      href={`/player/${p.id}`}
      className="grid grid-cols-[40px_1fr_auto] items-center gap-2 px-4 py-2.5 transition-colors hover:bg-white/[0.04] sm:grid-cols-[40px_1fr_minmax(0,90px)_repeat(6,minmax(0,46px))]"
    >
      <span className="text-center font-mono text-xs text-cream/50">{p.shirt_number ?? '–'}</span>

      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-cream">{p.name}</div>
        <div className="truncate text-[11px] text-cream/40 sm:hidden">
          {club} · {entry.apps} apps · {isGK ? `${entry.saves} saves` : `${entry.goals}G ${entry.assists}A`}
        </div>
      </div>

      <span className="hidden truncate text-[11px] text-cream/50 md:block">{club}</span>

      <span className="hidden text-center font-mono text-xs text-cream/60 sm:block">{entry.apps || '–'}</span>
      <span className="hidden text-center font-mono text-xs text-cream/60 sm:block">{entry.minutes_played || '–'}</span>
      <span className={clsx('hidden text-center font-mono text-xs sm:block', headlineHighlight ? 'font-bold text-amber-400' : 'text-cream/30')}>
        {headline || '–'}
      </span>
      <span className={clsx('hidden text-center font-mono text-xs sm:block', entry.assists > 0 ? 'font-bold text-emerald-400' : 'text-cream/30')}>
        {entry.assists || '–'}
      </span>
      <span className="hidden text-center text-xs sm:block">
        {entry.yellow_cards > 0
          ? <span className="font-mono font-bold text-amber-400">{entry.yellow_cards}</span>
          : <span className="text-cream/20">–</span>}
      </span>
      <span className="hidden text-center text-xs sm:block">
        {entry.red_cards > 0
          ? <span className="font-mono font-bold text-live">{entry.red_cards}</span>
          : <span className="text-cream/20">–</span>}
      </span>

      <span className="text-cream/30 sm:hidden">→</span>
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-4">
      <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">{eyebrow}</div>
      <h2 className="font-display text-2xl tracking-wide text-cream sm:text-3xl">{title}</h2>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-8">
      <div className="h-7 w-24 rounded-full shimmer" />
      <div className="h-72 rounded-3xl shimmer" />
      <div className="h-60 rounded-2xl shimmer" />
      <div className="h-60 rounded-2xl shimmer" />
    </div>
  )
}
