'use client'

import { use } from 'react'
import { useMatch } from '@/lib/hooks'
import { MatchDetail, MatchEvent, LineupPlayer, PlayerMatchStats, MatchLineup, Team } from '@/lib/types'
import { displayScore, formatKickoff, formatMinute, positionOrder, stageName } from '@/lib/utils'
import Image from 'next/image'
import Link from 'next/link'
import clsx from 'clsx'

export default function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data, isLoading } = useMatch(id)

  if (isLoading) return <MatchSkeleton />
  if (!data) return <div className="text-center text-cream/40 py-20">Match not found</div>

  const detail: MatchDetail = data
  const { match, lineups, events, stats } = detail
  const homeId = match.home_team?.id ?? -1
  const awayId = match.away_team?.id ?? -1

  const homeLineup = match.home_team ? lineups.find(l => l.team.id === homeId) : undefined
  const awayLineup = match.away_team ? lineups.find(l => l.team.id === awayId) : undefined

  return (
    <div className="space-y-10 sm:space-y-14">
      <Link
        href="/"
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-cream/60 transition-colors hover:border-amber-400/30 hover:text-gold"
      >
        ← Back to Groups
      </Link>

      <CinematicScoreHeader match={match} />

      {/* Family picks shortcut — only meaningful once the match has kicked off */}
      {(match.status !== 'scheduled') && (
        <div className="flex justify-end">
          <Link
            href={`/compete/match/${match.id}`}
            className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-bold tracking-widest text-amber-400 hover:bg-amber-500/20"
          >
            FAMILY PICKS →
          </Link>
        </div>
      )}

      {/* Visual timeline */}
      {events.length > 0 && match.home_team && match.away_team && (
        <section>
          <SectionHeading eyebrow="MINUTE BY MINUTE" title="Match Timeline" />
          <Timeline events={events} homeId={homeId} awayId={awayId} homeTeam={match.home_team} awayTeam={match.away_team} />
        </section>
      )}

      {/* Pitch lineups */}
      {(homeLineup || awayLineup) && (
        <section>
          <SectionHeading eyebrow="STARTING XI" title="Lineups" />
          <div className="grid gap-6 lg:grid-cols-2">
            {homeLineup && <PitchDiagram lineup={homeLineup} side="home" />}
            {awayLineup && <PitchDiagram lineup={awayLineup} side="away" />}
          </div>

          {/* Substitutes panel */}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {homeLineup && <SubstitutesCard lineup={homeLineup} />}
            {awayLineup && <SubstitutesCard lineup={awayLineup} />}
          </div>
        </section>
      )}

      {/* Player stats with bar charts */}
      {stats.length > 0 && (
        <section>
          <SectionHeading eyebrow="DATA" title="Player Statistics" />
          <div className="grid gap-6 lg:grid-cols-2">
            {[homeId, awayId].map(tid => {
              const teamStats = stats.filter(s => s.team.id === tid)
              if (!teamStats.length) return null
              const team = teamStats[0].team
              return <PlayerStatsCard key={tid} team={team} stats={teamStats} />
            })}
          </div>
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cinematic score header
// ---------------------------------------------------------------------------

function CinematicScoreHeader({ match }: { match: MatchDetail['match'] }) {
  const { home, away, suffix } = displayScore(match)
  const isLive = match.status.startsWith('live')
  const isScheduled = match.status === 'scheduled'
  const isFinal = match.status === 'final'

  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/10 panel">
      {/* Glow accents */}
      <div className="absolute inset-0 opacity-60">
        <div className="absolute -top-32 left-1/4 h-72 w-72 rounded-full bg-amber-500/20 blur-3xl" />
        <div className="absolute -bottom-32 right-1/4 h-72 w-72 rounded-full bg-navy-500/30 blur-3xl" />
      </div>

      <div className="relative">
        {/* Top meta strip */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 bg-black/30 px-5 py-2.5 text-[10px] font-bold tracking-[0.25em] text-cream/40">
          <span>{stageName(match.stage).toUpperCase()}{match.group_name ? ` · GROUP ${match.group_name}` : ''}</span>
          {match.venue && (
            <span className="text-cream/40">
              {match.venue.name.toUpperCase()} · {match.venue.city.toUpperCase()}
              {match.venue.number_games != null && (
                <span className="ml-2 text-amber-400/60">· {match.venue.number_games} WC GAMES</span>
              )}
            </span>
          )}
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-10 sm:px-8 sm:py-14">
          {match.home_team
            ? <TeamHero team={match.home_team} isWinner={match.winner_id === match.home_team.id} align="right" />
            : <TbdHero align="right" />}

          {/* Score block */}
          <div className="text-center min-w-[120px] sm:min-w-[180px] lg:min-w-[260px]">
            {isScheduled ? (
              <div>
                <div className="font-display text-4xl tracking-wider text-cream/30 sm:text-6xl lg:text-7xl">VS</div>
                <div className="mt-3 text-xs font-semibold tracking-widest text-amber-400">
                  {formatKickoff(match.scheduled_at).toUpperCase()}
                </div>
              </div>
            ) : (
              <div>
                <div className={clsx(
                  'flex items-center justify-center gap-1.5 font-display leading-none tracking-tight tabular-nums sm:gap-3 lg:gap-6',
                  isLive ? 'drop-shadow-[0_0_20px_rgba(251,191,36,0.4)]' : ''
                )}>
                  <span className={clsx(
                    'text-5xl sm:text-7xl lg:text-9xl',
                    isLive ? 'text-amber-400 animate-score-in' : 'text-cream'
                  )}>
                    {home}
                  </span>
                  <span className={clsx(
                    'text-3xl sm:text-5xl lg:text-7xl',
                    isLive ? 'text-live/70' : 'text-cream/20'
                  )}>:</span>
                  <span className={clsx(
                    'text-5xl sm:text-7xl lg:text-9xl',
                    isLive ? 'text-amber-400 animate-score-in' : 'text-cream'
                  )}>
                    {away}
                  </span>
                </div>

                {/* Status pill */}
                <div className="mt-4 flex flex-col items-center gap-1.5">
                  {isLive && (
                    <span className="inline-flex items-center gap-2 rounded-full bg-live/15 px-3 py-1 text-xs font-bold tracking-widest text-live">
                      <span className="live-dot" />
                      LIVE{match.status === 'live_et' ? ' · ET' : match.status === 'live_penalties' ? ' · PENS' : ''}
                    </span>
                  )}
                  {isFinal && (
                    <span className="inline-flex items-center rounded-full bg-white/8 px-3 py-1 text-[10px] font-bold tracking-widest text-cream/50">
                      FULL TIME{suffix && !suffix.includes('pens') ? ` · ${suffix.toUpperCase()}` : ''}
                    </span>
                  )}
                  {suffix && suffix.includes('pens') && (
                    <span className="inline-flex items-center rounded-full bg-amber-500/15 px-3 py-1 text-[10px] font-bold tracking-widest text-amber-400">
                      {suffix.toUpperCase()}
                    </span>
                  )}
                  {match.score.ht_home !== null && (
                    <span className="text-[11px] font-mono text-cream/35">
                      HT {match.score.ht_home}–{match.score.ht_away}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {match.away_team
            ? <TeamHero team={match.away_team} isWinner={match.winner_id === match.away_team.id} align="left" />
            : <TbdHero align="left" />}
        </div>
      </div>
    </section>
  )
}

function TbdHero({ align }: { align: 'left' | 'right' }) {
  return (
    <div className={clsx(
      'flex flex-col items-center gap-3 text-center sm:gap-4',
      align === 'left' ? 'lg:items-start lg:text-left' : 'lg:items-end lg:text-right'
    )}>
      <div className="flex h-16 w-24 items-center justify-center rounded-xl border border-dashed border-white/15 bg-white/[0.03] text-cream/40 sm:h-20 sm:w-28">
        <span className="font-display text-2xl tracking-widest">?</span>
      </div>
      <div>
        <div className="font-display text-lg leading-none tracking-wider text-cream/40 sm:text-2xl lg:text-3xl">TBD</div>
        <div className="mt-1 font-mono text-[10px] tracking-[0.3em] text-cream/30">AWAITING WINNERS</div>
      </div>
    </div>
  )
}

function TeamHero({ team, isWinner, align }: { team: Team; isWinner: boolean; align: 'left' | 'right' }) {
  return (
    <div className={clsx(
      'flex flex-col items-center gap-3 text-center sm:gap-4',
      align === 'left' ? 'lg:items-start lg:text-left' : 'lg:items-end lg:text-right'
    )}>
      <FlagBig url={team.flag_url} code={team.code} />
      <div>
        <div className={clsx(
          'font-display text-lg leading-none tracking-wider sm:text-2xl lg:text-3xl',
          isWinner ? 'text-cream' : 'text-cream/70'
        )}>
          {team.name.toUpperCase()}
        </div>
        <div className="mt-1 flex items-center justify-center gap-2">
          <span className="font-mono text-[10px] tracking-[0.3em] text-cream/35">{team.code}</span>
          {team.world_rank != null && (
            <span
              title={`FIFA world ranking #${team.world_rank}`}
              className="rounded-sm bg-amber-500/10 px-1.5 py-px font-mono text-[10px] font-bold text-amber-400/80"
            >
              FIFA #{team.world_rank}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function FlagBig({ url, code }: { url: string | null; code: string }) {
  if (!url) {
    return (
      <span className="flex h-16 w-24 items-center justify-center rounded-xl bg-white/10 text-sm font-bold text-cream/50 ring-2 ring-black/40">
        {code}
      </span>
    )
  }
  return (
    <div className="relative h-16 w-24 sm:h-20 sm:w-28">
      <Image
        src={url}
        alt={code}
        fill
        sizes="(min-width: 640px) 112px, 96px"
        className="rounded-xl object-cover shadow-xl ring-2 ring-black/40"
        unoptimized
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Visual timeline (center spine)
// ---------------------------------------------------------------------------

const EVENT_GLYPH: Record<string, React.ReactNode> = {
  goal: <GoalIcon />,
  own_goal: <GoalIcon />,
  goal_penalty_miss: <span className="font-mono text-sm font-bold text-cream/60">✕</span>,
  yellow_card: <CardIcon color="amber" />,
  yellow_red_card: <CardIcon color="amber-red" />,
  red_card: <CardIcon color="red" />,
  substitution_off: <SubIcon />,
  substitution_on: <SubIcon />,
  assist: <span className="font-display text-xs text-cream/60">A</span>,
}

function GoalIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.93 9h-2.05a14.7 14.7 0 0 0-1.32-5.2A8.04 8.04 0 0 1 18.93 11ZM12 4a12.7 12.7 0 0 1 1.96 7H10.04A12.7 12.7 0 0 1 12 4ZM5.07 11A8.04 8.04 0 0 1 8.44 5.8 14.7 14.7 0 0 0 7.12 11H5.07Zm0 2h2.05a14.7 14.7 0 0 0 1.32 5.2A8.04 8.04 0 0 1 5.07 13Zm6.93 7a12.7 12.7 0 0 1-1.96-7h3.92A12.7 12.7 0 0 1 12 20Zm3.56-1.8A14.7 14.7 0 0 0 16.88 13h2.05a8.04 8.04 0 0 1-3.37 5.2Z"/>
    </svg>
  )
}

function CardIcon({ color }: { color: 'amber' | 'red' | 'amber-red' }) {
  if (color === 'amber-red') {
    return (
      <span className="flex h-4 gap-[2px]">
        <span className="h-4 w-2.5 rounded-sm bg-amber-400" />
        <span className="h-4 w-2.5 rounded-sm bg-live" />
      </span>
    )
  }
  return (
    <span className={clsx(
      'h-4 w-3 rounded-sm',
      color === 'amber' ? 'bg-amber-400' : 'bg-live'
    )} />
  )
}

function SubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7 7l-3 3 3 3" />
      <path d="M4 10h14a3 3 0 0 1 3 3v0" />
      <path d="M17 21l3-3-3-3" />
      <path d="M20 18H6a3 3 0 0 1-3-3" />
    </svg>
  )
}

function Timeline({ events, homeId, awayId, homeTeam, awayTeam }: {
  events: MatchEvent[]; homeId: number; awayId: number; homeTeam: Team; awayTeam: Team
}) {
  // Sort by minute + period
  const periodOrder = { normal: 0, extra_time_1: 1, extra_time_2: 2, penalties: 3 } as Record<string, number>
  const sorted = [...events]
    .filter(e => !['assist', 'substitution_on'].includes(e.event_type))
    .sort((a, b) => {
      const po = (periodOrder[a.period] ?? 0) - (periodOrder[b.period] ?? 0)
      if (po) return po
      return (a.minute - b.minute) || (a.added_time - b.added_time)
    })

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 panel">
      {/* Header bar with teams */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 border-b border-white/5 bg-black/30 px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          <span className="font-display text-sm tracking-wider text-cream">{homeTeam.code}</span>
          <FlagSm url={homeTeam.flag_url} code={homeTeam.code} />
        </div>
        <span className="text-[10px] font-bold tracking-widest text-cream/30">MIN</span>
        <div className="flex items-center gap-2">
          <FlagSm url={awayTeam.flag_url} code={awayTeam.code} />
          <span className="font-display text-sm tracking-wider text-cream">{awayTeam.code}</span>
        </div>
      </div>

      <div className="relative px-3 py-6 sm:px-6">
        {/* Center spine */}
        <div className="pointer-events-none absolute left-1/2 top-0 bottom-0 -ml-px w-px bg-gradient-to-b from-transparent via-white/15 to-transparent" />

        <div className="space-y-3">
          {sorted.map(e => (
            <TimelineRow
              key={e.id}
              event={e}
              isHome={e.team_id === homeId}
              allEvents={events}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function TimelineRow({ event, isHome, allEvents }: { event: MatchEvent; isHome: boolean; allEvents: MatchEvent[] }) {
  const isGoal = event.event_type === 'goal' || event.event_type === 'own_goal'
  const isCard = event.event_type.includes('card')
  const isSub = event.event_type === 'substitution_off'

  const assist = isGoal
    ? allEvents.find(e => e.event_type === 'assist' && e.related_event_id === event.id)
    : null
  const subOn = isSub
    ? allEvents.find(e => e.event_type === 'substitution_on' && e.related_event_id === event.id)
    : null

  const glyph = EVENT_GLYPH[event.event_type] ?? <span>•</span>

  const iconColor = isGoal
    ? (event.is_own_goal ? 'bg-cream/15 text-cream/60 ring-cream/20'
                          : 'bg-amber-500 text-ink ring-amber-400/60 shadow-[0_0_16px_rgba(251,191,36,0.4)]')
    : isCard ? (event.event_type === 'red_card' ? 'bg-live/15 text-live ring-live/30' : 'bg-amber-400/15 text-amber-400 ring-amber-400/30')
    : isSub ? 'bg-emerald-500/15 text-emerald-400 ring-emerald-400/30'
    : 'bg-cream/10 text-cream/60 ring-cream/20'

  const label = (
    <div className={clsx('flex flex-col gap-0.5 max-w-full', isHome ? 'items-end text-right' : 'items-start text-left')}>
      <span className={clsx(
        'text-sm font-bold leading-snug',
        isGoal && !event.is_own_goal ? 'text-cream' : 'text-cream/85'
      )}>
        {event.player_name}
        {event.is_penalty && <span className="ml-1 text-xs text-amber-400">(P)</span>}
        {event.is_own_goal && <span className="ml-1 text-xs text-cream/40">(OG)</span>}
      </span>
      {assist && (
        <span className="text-[11px] text-cream/40">
          Assist: <span className="text-cream/60">{assist.player_name}</span>
        </span>
      )}
      {subOn && (
        <span className="text-[11px] text-emerald-400/80">
          ↑ {subOn.player_name}
        </span>
      )}
      <span className="text-[10px] font-bold uppercase tracking-widest text-cream/30">
        {event.event_type.replaceAll('_', ' ')}
      </span>
    </div>
  )

  return (
    <div className="relative grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-4 animate-fade-up">
      {/* Home side */}
      <div className={clsx('min-w-0', isHome ? '' : 'invisible')}>
        {isHome && label}
      </div>

      {/* Center node */}
      <div className="flex flex-col items-center gap-1">
        <span className="font-mono text-[10px] font-bold text-cream/30">
          {formatMinute(event.minute, event.added_time)}
        </span>
        <span className={clsx(
          'flex h-9 w-9 items-center justify-center rounded-full ring-2',
          iconColor
        )}>
          {glyph}
        </span>
      </div>

      {/* Away side */}
      <div className={clsx('min-w-0', !isHome ? '' : 'invisible')}>
        {!isHome && label}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pitch diagram for starting XI
// ---------------------------------------------------------------------------

function PitchDiagram({ lineup, side }: { lineup: MatchLineup; side: 'home' | 'away' }) {
  // Bucket players by position
  const buckets: Record<string, LineupPlayer[]> = { GK: [], DEF: [], MID: [], FWD: [], OTHER: [] }
  for (const lp of lineup.starters) {
    const pos = (lp.position_played ?? lp.player.position ?? 'OTHER') as string
    // Map detailed positions to broad buckets
    const broad = pos === 'G' ? 'GK'
                : pos === 'D' || pos.startsWith('D') ? 'DEF'
                : pos === 'M' || pos.startsWith('M') ? 'MID'
                : pos === 'F' || pos === 'A' || pos.startsWith('F') || pos.startsWith('A') ? 'FWD'
                : (buckets as any)[pos] ? pos : 'OTHER'
    ;(buckets[broad] ?? buckets.OTHER).push(lp)
  }
  if (buckets.OTHER.length && !buckets.MID.length) {
    buckets.MID = buckets.OTHER; buckets.OTHER = []
  }

  // Order rows by side: home goes GK→DEF→MID→FWD top to bottom; away mirrored
  const rowsOrder = side === 'home'
    ? ['GK', 'DEF', 'MID', 'FWD'] as const
    : ['FWD', 'MID', 'DEF', 'GK'] as const

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 panel">
      <div className="flex items-center justify-between gap-3 border-b border-white/5 bg-black/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <FlagSm url={lineup.team.flag_url} code={lineup.team.code} />
          <span className="font-display text-sm tracking-wider text-cream">{lineup.team.name.toUpperCase()}</span>
        </div>
        <span className="text-[10px] font-bold tracking-widest text-cream/40">STARTING XI</span>
      </div>

      <div className="pitch-bg relative aspect-[3/4] sm:aspect-[4/5]">
        {/* Pitch markings */}
        <PitchMarkings />

        <div className="relative h-full w-full flex flex-col py-4 px-2 sm:px-4">
          {rowsOrder.map(row => {
            const players = buckets[row] ?? []
            if (!players.length) return null
            return (
              <div key={row} className="flex flex-1 items-center justify-evenly gap-2">
                {players.map(lp => <PitchPlayer key={lp.player.id} lp={lp} />)}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function PitchMarkings() {
  return (
    <svg
      viewBox="0 0 100 130"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full text-white/15"
      aria-hidden
    >
      <g fill="none" stroke="currentColor" strokeWidth="0.4">
        {/* Outer */}
        <rect x="2" y="2" width="96" height="126" />
        {/* Midline */}
        <line x1="2" y1="65" x2="98" y2="65" />
        <circle cx="50" cy="65" r="8" />
        <circle cx="50" cy="65" r="0.6" fill="currentColor" />
        {/* Top penalty area */}
        <rect x="22" y="2" width="56" height="16" />
        <rect x="36" y="2" width="28" height="6" />
        <circle cx="50" cy="13" r="0.6" fill="currentColor" />
        {/* Bottom penalty area */}
        <rect x="22" y="112" width="56" height="16" />
        <rect x="36" y="122" width="28" height="6" />
        <circle cx="50" cy="117" r="0.6" fill="currentColor" />
      </g>
    </svg>
  )
}

function PitchPlayer({ lp }: { lp: LineupPlayer }) {
  return (
    <Link
      href={`/player/${lp.player.id}`}
      className="group/p flex flex-col items-center gap-1 text-center"
    >
      <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-cream to-cream/70 font-display text-sm text-ink shadow-lg ring-2 ring-black/40 transition-transform group-hover/p:scale-110 sm:h-11 sm:w-11">
        {lp.shirt_number ?? lp.player.shirt_number ?? '?'}
      </span>
      <span className="max-w-[80px] truncate rounded-md bg-black/50 px-1.5 py-0.5 text-[10px] font-semibold text-cream backdrop-blur sm:max-w-[100px] sm:text-[11px]">
        {lp.player.name.split(' ').slice(-1)[0]}
      </span>
    </Link>
  )
}

function SubstitutesCard({ lineup }: { lineup: MatchLineup }) {
  if (!lineup.substitutes.length) return null
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 panel">
      <div className="flex items-center justify-between border-b border-white/5 bg-black/30 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <FlagSm url={lineup.team.flag_url} code={lineup.team.code} />
          <span className="font-display text-sm tracking-wider text-cream/80">{lineup.team.code} BENCH</span>
        </div>
        <span className="text-[10px] font-bold tracking-widest text-cream/40">{lineup.substitutes.length} SUBS</span>
      </div>
      <div className="divide-y divide-white/5">
        {lineup.substitutes.map(lp => (
          <Link
            key={lp.player.id}
            href={`/player/${lp.player.id}`}
            className="group flex items-center gap-3 px-4 py-2 transition-colors hover:bg-white/[0.04]"
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/8 font-mono text-[11px] font-bold text-cream/70">
              {lp.shirt_number ?? lp.player.shirt_number ?? '–'}
            </span>
            <PositionBadge pos={lp.position_played ?? lp.player.position} />
            <span className="flex-1 truncate text-sm text-cream/80 group-hover:text-cream">
              {lp.player.name}
            </span>
            {lp.subbed_on_minute && (
              <span className="text-[11px] font-bold text-emerald-400">↑ {lp.subbed_on_minute}'</span>
            )}
          </Link>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Player stats card with bar charts
// ---------------------------------------------------------------------------

function PlayerStatsCard({ team, stats }: { team: Team; stats: PlayerMatchStats[] }) {
  // Compute team-wide max for bar normalization
  const maxShots = Math.max(1, ...stats.map(s => s.shots_total))
  const maxPasses = Math.max(1, ...stats.map(s => s.passes_attempted))
  const maxMinutes = Math.max(1, ...stats.map(s => s.minutes_played))

  const sorted = [...stats].sort((a, b) =>
    (b.is_starter ? 1 : 0) - (a.is_starter ? 1 : 0) || b.goals - a.goals || b.minutes_played - a.minutes_played
  )

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 panel">
      <div className="flex items-center justify-between gap-3 border-b border-white/5 bg-black/30 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <FlagSm url={team.flag_url} code={team.code} />
          <span className="font-display text-sm tracking-wider text-cream">{team.name.toUpperCase()}</span>
        </div>
        <span className="text-[10px] font-bold tracking-widest text-cream/40">{stats.length} PLAYERS</span>
      </div>

      <div className="divide-y divide-white/5">
        {sorted.map(s => {
          const passAcc = s.passes_attempted > 0
            ? Math.round((s.passes_completed / s.passes_attempted) * 100)
            : null
          const minutesPct = (s.minutes_played / maxMinutes) * 100
          const shotsPct = (s.shots_total / maxShots) * 100
          const passesPct = (s.passes_attempted / maxPasses) * 100

          return (
            <div key={s.player.id} className="px-4 py-3 transition-colors hover:bg-white/[0.03]">
              {/* Top row: name + key stats */}
              <div className="flex items-center justify-between gap-3">
                <Link href={`/player/${s.player.id}`} className="flex items-center gap-2 min-w-0 group/n">
                  <span className={clsx(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold',
                    s.is_starter ? 'bg-amber-500/20 text-amber-400' : 'bg-white/10 text-cream/40'
                  )}>
                    {s.is_starter ? '★' : 'S'}
                  </span>
                  <span className={clsx(
                    'truncate text-sm font-semibold transition-colors group-hover/n:text-gold',
                    s.is_starter ? 'text-cream' : 'text-cream/60'
                  )}>
                    {s.player.name}
                  </span>
                </Link>
                <div className="flex items-center gap-3 text-xs shrink-0">
                  {s.goals > 0 && <span className="font-bold text-amber-400">⚽ {s.goals}</span>}
                  {s.assists > 0 && <span className="text-emerald-400">A {s.assists}</span>}
                  {s.yellow_cards > 0 && <span className="h-3 w-2 rounded-sm bg-amber-400" />}
                  {s.red_cards > 0 && <span className="h-3 w-2 rounded-sm bg-live" />}
                </div>
              </div>

              {/* Bar charts row */}
              <div className="mt-2 grid grid-cols-3 gap-3">
                <StatBar label="Min" value={`${s.minutes_played}'`} pct={minutesPct} color="cream" />
                <StatBar label="Shots" value={s.shots_total} pct={shotsPct} color="amber" />
                <StatBar
                  label="Pass %"
                  value={passAcc !== null ? `${passAcc}%` : '—'}
                  pct={passAcc ?? 0}
                  color={passAcc !== null && passAcc >= 85 ? 'emerald' : 'navy'}
                />
              </div>

              {/* Inline pass-completion bar */}
              {s.passes_attempted > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="font-mono text-[10px] text-cream/30 w-12">{s.passes_completed}/{s.passes_attempted}</span>
                  <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/5">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400"
                      style={{ width: `${(s.passes_completed / s.passes_attempted) * 100}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-cream/30 w-12 text-right">passes</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatBar({ label, value, pct, color }: {
  label: string; value: string | number; pct: number; color: 'cream' | 'amber' | 'emerald' | 'navy'
}) {
  const bar = {
    cream:   'from-cream/70 to-cream/40',
    amber:   'from-amber-500 to-amber-400',
    emerald: 'from-emerald-500 to-emerald-400',
    navy:    'from-navy-500 to-navy-700',
  }[color]
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-[10px] font-bold tracking-widest text-cream/30">{label}</span>
        <span className="font-mono text-xs font-semibold text-cream/80">{value}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/5">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${bar}`}
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function PositionBadge({ pos }: { pos: string | null }) {
  if (!pos) return null
  const colors: Record<string, string> = {
    GK:  'bg-amber-400/15 text-amber-400 ring-amber-400/30',
    DEF: 'bg-blue-400/15 text-blue-400 ring-blue-400/30',
    MID: 'bg-emerald-400/15 text-emerald-400 ring-emerald-400/30',
    FWD: 'bg-rose-400/15 text-rose-400 ring-rose-400/30',
    G:   'bg-amber-400/15 text-amber-400 ring-amber-400/30',
    D:   'bg-blue-400/15 text-blue-400 ring-blue-400/30',
    M:   'bg-emerald-400/15 text-emerald-400 ring-emerald-400/30',
    F:   'bg-rose-400/15 text-rose-400 ring-rose-400/30',
    A:   'bg-rose-400/15 text-rose-400 ring-rose-400/30',
  }
  const base = colors[pos] ?? 'bg-white/10 text-cream/50 ring-white/10'
  const broad = pos === 'G' ? 'GK' : pos === 'D' ? 'DEF' : pos === 'M' ? 'MID' : pos === 'F' || pos === 'A' ? 'FWD' : pos
  return (
    <span className={clsx(
      'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wider ring-1',
      base
    )}>
      {broad}
    </span>
  )
}

function FlagSm({ url, code }: { url: string | null; code: string }) {
  if (!url) {
    return (
      <span className="flex h-5 w-7 items-center justify-center rounded-sm bg-white/10 text-[9px] font-bold text-cream/50 ring-1 ring-black/40">
        {code}
      </span>
    )
  }
  return (
    <Image
      src={url}
      alt={code}
      width={28}
      height={20}
      className="h-5 w-7 shrink-0 rounded-sm object-cover ring-1 ring-black/40"
      unoptimized
    />
  )
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-5">
      <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">{eyebrow}</div>
      <h2 className="font-display text-2xl tracking-wide text-cream sm:text-3xl">{title}</h2>
    </div>
  )
}

function MatchSkeleton() {
  return (
    <div className="space-y-10">
      <div className="h-7 w-32 rounded-full shimmer" />
      <div className="h-72 rounded-3xl shimmer" />
      <div className="h-96 rounded-2xl shimmer" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-96 rounded-2xl shimmer" />
        <div className="h-96 rounded-2xl shimmer" />
      </div>
    </div>
  )
}
