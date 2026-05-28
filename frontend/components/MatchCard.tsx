'use client'

import Link from 'next/link'
import Image from 'next/image'
import { MatchSummary } from '@/lib/types'
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
        'group block rounded-xl border transition-all duration-200 overflow-hidden',
        'hover:border-gold/40 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-gold/10',
        isLive
          ? 'border-gold/30 bg-pitch/60 shadow-md shadow-gold/10'
          : 'border-white/8 bg-white/3'
      )}
    >
      <div className="p-4">
        {/* Status bar */}
        <div className="flex items-center justify-between mb-3">
          {isLive ? (
            <span className="live-badge flex items-center gap-1.5 rounded-full bg-gold/15 px-2.5 py-1 text-xs font-semibold text-gold">
              <span className="h-1.5 w-1.5 rounded-full bg-gold animate-pulse" />
              LIVE
              {match.status === 'live_et' && ' · ET'}
              {match.status === 'live_penalties' && ' · PENS'}
            </span>
          ) : isFinal ? (
            <span className="rounded-full bg-white/8 px-2.5 py-1 text-xs font-medium text-cream/40">
              FT{suffix ? ` · ${suffix}` : ''}
            </span>
          ) : (
            <span className="text-xs text-cream/30 font-medium">
              {formatKickoff(match.scheduled_at)}
            </span>
          )}
          {match.venue && (
            <span className="text-xs text-cream/25 hidden sm:block">
              {match.venue.city}
            </span>
          )}
        </div>

        {/* Score row */}
        <div className="flex items-center gap-3">
          {/* Home */}
          <div className="flex flex-1 items-center justify-end gap-2">
            <span className={clsx(
              'text-sm font-semibold text-right leading-tight',
              match.winner_id === match.home_team.id ? 'text-cream' : 'text-cream/60'
            )}>
              {match.home_team.name}
            </span>
            <FlagImg url={match.home_team.flag_url} code={match.home_team.code} />
          </div>

          {/* Score */}
          <div className={clsx(
            'flex min-w-[4.5rem] items-center justify-center gap-1 rounded-lg py-1.5 px-3',
            isLive ? 'bg-gold/10' : 'bg-white/5'
          )}>
            {isScheduled ? (
              <span className="text-sm text-cream/30 font-mono">vs</span>
            ) : (
              <>
                <ScoreDigit value={home} animated={isLive} />
                <span className="text-cream/30 font-mono text-base">–</span>
                <ScoreDigit value={away} animated={isLive} />
              </>
            )}
          </div>

          {/* Away */}
          <div className="flex flex-1 items-center gap-2">
            <FlagImg url={match.away_team.flag_url} code={match.away_team.code} />
            <span className={clsx(
              'text-sm font-semibold leading-tight',
              match.winner_id === match.away_team.id ? 'text-cream' : 'text-cream/60'
            )}>
              {match.away_team.name}
            </span>
          </div>
        </div>

        {/* Penalty suffix */}
        {suffix && suffix.includes('pens') && (
          <p className="mt-2 text-center text-xs text-gold/60 font-medium">{suffix}</p>
        )}
      </div>

      {/* Hover cue */}
      <div className="border-t border-white/5 px-4 py-2 flex justify-end opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-xs text-gold/60">Match details →</span>
      </div>
    </Link>
  )
}

function FlagImg({ url, code }: { url: string | null; code: string }) {
  if (!url) {
    return (
      <span className="flex h-6 w-9 items-center justify-center rounded bg-white/10 text-xs font-bold text-cream/40">
        {code}
      </span>
    )
  }
  return (
    <Image
      src={url}
      alt={code}
      width={36}
      height={24}
      className="rounded object-cover h-6 w-9"
      unoptimized
    />
  )
}

function ScoreDigit({ value, animated }: { value: number | null; animated: boolean }) {
  return (
    <span
      key={value}
      className={clsx(
        'min-w-[1rem] text-center font-mono text-xl font-black',
        animated ? 'text-gold animate-score-in' : 'text-cream'
      )}
    >
      {value ?? '–'}
    </span>
  )
}
