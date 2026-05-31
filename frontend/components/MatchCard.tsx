'use client'

import Link from 'next/link'
import Image from 'next/image'
import { MatchSummary, Team } from '@/lib/types'
import { displayScore, formatKickoff } from '@/lib/utils'
import clsx from 'clsx'

export function MatchCard({ match }: { match: MatchSummary }) {
  const { home, away, suffix } = displayScore(match)
  const isLive = match.status.startsWith('live')
  const isFinal = match.status === 'final'
  const isScheduled = match.status === 'scheduled'

  return (
    <Link
      href={`/match/${match.id}`}
      className={clsx(
        'group relative block overflow-hidden rounded-2xl border transition-all duration-300 hover-lift',
        isLive
          ? 'border-live/40 bg-gradient-to-br from-live/10 via-amber-500/5 to-navy-800/40 shadow-[0_8px_32px_-12px_rgba(239,68,68,0.35)]'
          : isFinal
          ? 'border-white/8 bg-panel-gradient hover:border-amber-400/30'
          : 'border-white/8 bg-panel-gradient hover:border-amber-400/30'
      )}
    >
      {/* Top status bar */}
      <div className={clsx(
        'flex items-center justify-between px-4 py-2 text-[10px] font-bold tracking-widest',
        isLive
          ? 'bg-live/15 text-live'
          : isFinal
          ? 'bg-white/5 text-cream/40'
          : 'bg-white/[0.03] text-cream/40'
      )}>
        <span className="flex items-center gap-1.5">
          {isLive ? (
            <>
              <span className="live-dot" />
              LIVE
              {match.status === 'live_et' && <span className="text-amber-400"> · EXTRA TIME</span>}
              {match.status === 'live_penalties' && <span className="text-amber-400"> · PENALTIES</span>}
            </>
          ) : isFinal ? (
            <>FULL TIME{suffix && !suffix.includes('pens') ? ` · ${suffix.toUpperCase()}` : ''}</>
          ) : (
            <span className="text-cream/50">{formatKickoff(match.scheduled_at).toUpperCase()}</span>
          )}
        </span>
        {match.venue && (
          <span className="hidden sm:block text-cream/30 normal-case font-medium tracking-normal">
            {match.venue.city}
          </span>
        )}
      </div>

      {/* Scoreline */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-4 sm:gap-3">
        {/* Home */}
        <TeamSide team={match.home_team} side="home" winnerId={match.winner_id} isFinal={isFinal} />

        {/* Score */}
        <div className={clsx(
          'flex min-w-[4.5rem] items-center justify-center gap-1.5 rounded-xl px-2.5 py-2 sm:min-w-[5.5rem] sm:gap-2 sm:px-3',
          isLive
            ? 'bg-gradient-to-br from-live/20 to-amber-500/10 ring-1 ring-live/30'
            : isScheduled
            ? 'bg-white/5'
            : 'bg-white/[0.04] ring-1 ring-white/5'
        )}>
          {isScheduled ? (
            <span className="font-display text-xl tracking-wider text-cream/40">VS</span>
          ) : (
            <>
              <ScoreDigit value={home} isLive={isLive} isWinner={match.winner_id === match.home_team?.id} />
              <span className={clsx(
                'font-display text-2xl',
                isLive ? 'text-live/60' : 'text-cream/25'
              )}>:</span>
              <ScoreDigit value={away} isLive={isLive} isWinner={match.winner_id === match.away_team?.id} />
            </>
          )}
        </div>

        {/* Away */}
        <TeamSide team={match.away_team} side="away" winnerId={match.winner_id} isFinal={isFinal} />
      </div>

      {/* Penalty / AET suffix */}
      {suffix && suffix.includes('pens') && (
        <div className="-mt-2 pb-3 text-center">
          <span className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-bold tracking-widest text-amber-400">
            {suffix.toUpperCase()}
          </span>
        </div>
      )}

      {/* Hover affordance — collapses when not hovered */}
      <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-200 group-hover:grid-rows-[1fr]">
        <div className="overflow-hidden">
          <div className="border-t border-white/5 px-4 py-2 flex items-center justify-between">
            <span className="text-[10px] font-bold tracking-widest text-cream/30">MATCH DETAILS</span>
            <span className="text-xs text-gold">→</span>
          </div>
        </div>
      </div>
    </Link>
  )
}

function TeamSide({ team, side, winnerId, isFinal }: {
  team: Team | null
  side: 'home' | 'away'
  winnerId: number | null
  isFinal: boolean
}) {
  const isHome = side === 'home'
  const isWinner = team && winnerId === team.id

  if (!team) {
    // Knockout placeholder — no team yet
    return (
      <div className={clsx('flex items-center gap-2 min-w-0 sm:gap-3', isHome ? 'justify-end' : '')}>
        {!isHome && <FlagImg url={null} code="?" />}
        <div className={clsx('min-w-0', isHome ? 'text-right' : '')}>
          <div className="truncate text-xs italic font-semibold text-cream/30 leading-tight">TBD</div>
          <div className="font-mono text-[10px] tracking-widest text-cream/20 mt-0.5">—</div>
        </div>
        {isHome && <FlagImg url={null} code="?" />}
      </div>
    )
  }

  const nameBlock = (
    <div className={clsx('min-w-0', isHome ? 'text-right' : '')}>
      <div className="flex items-center gap-1.5 justify-end sm:justify-start" style={isHome ? { justifyContent: 'flex-end' } : undefined}>
        <div className={clsx(
          'truncate text-sm font-bold leading-tight',
          isWinner ? 'text-cream' : isFinal ? 'text-cream/50' : 'text-cream/85'
        )}>
          {team.name}
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-0.5" style={isHome ? { justifyContent: 'flex-end' } : undefined}>
        <span className="font-mono text-[10px] tracking-widest text-cream/30">{team.code}</span>
        {team.world_rank != null && (
          <span className="rounded-sm bg-white/5 px-1 py-px font-mono text-[9px] font-bold text-amber-400/70">
            #{team.world_rank}
          </span>
        )}
      </div>
    </div>
  )

  return (
    <div className={clsx('flex items-center gap-2 min-w-0 sm:gap-3', isHome ? 'justify-end' : '')}>
      {!isHome && <FlagImg url={team.flag_url} code={team.code} />}
      {nameBlock}
      {isHome && <FlagImg url={team.flag_url} code={team.code} />}
    </div>
  )
}

function FlagImg({ url, code }: { url: string | null; code: string }) {
  if (!url) {
    return (
      <span className="flex h-7 w-10 shrink-0 items-center justify-center rounded-md bg-white/10 text-[10px] font-bold text-cream/50 ring-1 ring-black/40 sm:h-9 sm:w-12">
        {code}
      </span>
    )
  }
  return (
    <Image
      src={url}
      alt={code}
      width={48}
      height={36}
      className="h-7 w-10 shrink-0 rounded-md object-cover shadow-md ring-1 ring-black/40 sm:h-9 sm:w-12"
      unoptimized
    />
  )
}

function ScoreDigit({ value, isLive, isWinner }: { value: number | null; isLive: boolean; isWinner: boolean }) {
  return (
    <span
      key={value}
      className={clsx(
        'min-w-[1.25rem] text-center font-display text-3xl leading-none tabular-nums tracking-tight',
        isLive
          ? 'text-amber-400 animate-score-in drop-shadow-[0_0_8px_rgba(251,191,36,0.4)]'
          : isWinner
          ? 'text-cream'
          : 'text-cream/65'
      )}
    >
      {value ?? '–'}
    </span>
  )
}
