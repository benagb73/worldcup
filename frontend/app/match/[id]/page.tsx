'use client'

import { useMatch } from '@/lib/hooks'
import { MatchDetail, MatchEvent, LineupPlayer, PlayerMatchStats, MatchLineup } from '@/lib/types'
import { displayScore, formatKickoff, formatMinute, positionOrder, EVENT_ICON, stageName } from '@/lib/utils'
import Image from 'next/image'
import Link from 'next/link'
import clsx from 'clsx'

export default function MatchPage({ params }: { params: { id: string } }) {
  const { data, isLoading } = useMatch(params.id)

  if (isLoading) return <MatchSkeleton />
  if (!data) return <div className="text-center text-cream/40 py-20">Match not found</div>

  const detail: MatchDetail = data
  const { match, lineups, events, stats } = detail
  const { home, away, suffix } = displayScore(match)
  const isLive = match.status.startsWith('live')

  // Split events by team for left/right display
  const homeId = match.home_team.id
  const awayId = match.away_team.id

  return (
    <div className="max-w-4xl mx-auto space-y-10">
      {/* Back */}
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-cream/30 hover:text-gold transition-colors">
        ← Back to Groups
      </Link>

      {/* Match header */}
      <div className="rounded-2xl border border-white/10 bg-white/3 overflow-hidden">
        <div className="bg-pitch/40 px-6 pt-6 pb-4">
          <div className="text-center mb-1">
            <span className="text-xs tracking-widest text-cream/30 uppercase">
              {stageName(match.stage)}
              {match.group_name ? ` · Group ${match.group_name}` : ''}
            </span>
          </div>

          <div className="flex items-center justify-between gap-4 py-4">
            {/* Home */}
            <TeamHero team={match.home_team} isWinner={match.winner_id === homeId} />

            {/* Score */}
            <div className="text-center min-w-[120px]">
              {match.status === 'scheduled' ? (
                <div>
                  <div className="font-display text-2xl font-black text-cream/20">vs</div>
                  <div className="mt-2 text-xs text-cream/30">{formatKickoff(match.scheduled_at)}</div>
                </div>
              ) : (
                <div>
                  <div className={clsx(
                    'font-mono text-5xl font-black',
                    isLive ? 'text-gold' : 'text-cream'
                  )}>
                    {home} – {away}
                  </div>
                  {suffix && (
                    <div className="mt-1 text-xs font-medium text-gold/60">{suffix}</div>
                  )}
                  {match.score.ht_home !== null && (
                    <div className="mt-1 text-xs text-cream/30">
                      HT: {match.score.ht_home}–{match.score.ht_away}
                    </div>
                  )}
                  {isLive && (
                    <div className="mt-2 flex items-center justify-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-gold animate-pulse" />
                      <span className="text-xs font-semibold text-gold">
                        LIVE{match.status === 'live_et' ? ' · ET' : match.status === 'live_penalties' ? ' · PENS' : ''}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Away */}
            <TeamHero team={match.away_team} isWinner={match.winner_id === awayId} />
          </div>

          {match.venue && (
            <div className="text-center text-xs text-cream/25 pb-2">
              {match.venue.name}, {match.venue.city}
            </div>
          )}
        </div>

        {/* Events timeline */}
        {events.length > 0 && (
          <div className="border-t border-white/5 px-4 py-4 space-y-1">
            {events
              .filter(e => !['substitution_on', 'assist'].includes(e.event_type))
              .map(e => <EventRow key={e.id} event={e} homeId={homeId} events={events} />)}
          </div>
        )}
      </div>

      {/* Lineups */}
      {lineups.length > 0 && (
        <section>
          <SectionHeading>Starting Lineups & Substitutes</SectionHeading>
          <div className="grid gap-6 md:grid-cols-2">
            {lineups.map(lu => <LineupCard key={lu.team.id} lineup={lu} />)}
          </div>
        </section>
      )}

      {/* Player stats */}
      {stats.length > 0 && (
        <section>
          <SectionHeading>Player Statistics</SectionHeading>
          <div className="grid gap-6 md:grid-cols-2">
            {[homeId, awayId].map(tid => {
              const teamStats = stats.filter(s => s.team.id === tid)
              if (!teamStats.length) return null
              const team = teamStats[0].team
              return (
                <div key={tid} className="rounded-xl border border-white/8 overflow-hidden">
                  <div className="bg-white/5 px-4 py-3 flex items-center gap-2">
                    <FlagImg url={team.flag_url} code={team.code} size="sm" />
                    <span className="font-semibold text-sm text-cream">{team.name}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <StatsTable stats={teamStats} />
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function TeamHero({ team, isWinner }: { team: any; isWinner: boolean }) {
  return (
    <div className="flex flex-1 flex-col items-center gap-2 text-center">
      <FlagImg url={team.flag_url} code={team.code} size="lg" />
      <span className={clsx(
        'text-sm font-semibold leading-tight',
        isWinner ? 'text-cream' : 'text-cream/60'
      )}>
        {team.name}
      </span>
    </div>
  )
}

function EventRow({ event, homeId, events }: { event: MatchEvent; homeId: number; events: MatchEvent[] }) {
  const isHome = event.team_id === homeId
  const icon = EVENT_ICON[event.event_type] ?? '•'
  const isGoal = event.event_type === 'goal' || event.event_type === 'own_goal'
  const isMiss = event.event_type === 'goal_penalty_miss'

  // Find assist for this goal
  const assist = isGoal
    ? events.find(e => e.event_type === 'assist' && e.related_event_id === event.id)
    : null

  // Find player coming on for subs
  const subOn = event.event_type === 'substitution_off'
    ? events.find(e => e.event_type === 'substitution_on' && e.related_event_id === event.id)
    : null

  const label = (
    <div className={clsx('flex items-center gap-1.5', isHome ? 'flex-row' : 'flex-row-reverse')}>
      <span className={clsx(
        'text-base leading-none',
        isMiss ? 'opacity-40' : '',
        event.event_type === 'red_card' || event.event_type === 'yellow_red_card' ? 'text-red-400' : ''
      )}>
        {icon}
      </span>
      <div className={clsx('text-xs', isHome ? 'text-left' : 'text-right')}>
        <span className={clsx(
          'font-medium',
          isGoal && !event.is_own_goal ? 'text-gold' : 'text-cream/70'
        )}>
          {event.player_name}
          {event.is_penalty && ' (P)'}
          {event.is_own_goal && ' (OG)'}
        </span>
        {assist && (
          <span className="block text-cream/30 text-[11px]">
            Assist: {assist.player_name}
          </span>
        )}
        {subOn && (
          <span className="block text-green-400/60 text-[11px]">
            ↑ {subOn.player_name}
          </span>
        )}
      </div>
    </div>
  )

  return (
    <div className={clsx('flex items-center gap-2', isHome ? 'justify-start' : 'justify-end')}>
      <div className={clsx('w-5/12', isHome ? '' : 'order-1')}>
        {label}
      </div>
      <div className="w-2/12 text-center">
        <span className="text-xs font-mono text-cream/25">
          {formatMinute(event.minute, event.added_time)}
        </span>
      </div>
      <div className="w-5/12" />
    </div>
  )
}

function LineupCard({ lineup }: { lineup: MatchLineup }) {
  const sorted = [...lineup.starters].sort(
    (a, b) => positionOrder(a.position_played ?? a.player.position)
            - positionOrder(b.position_played ?? b.player.position)
  )

  return (
    <div className="rounded-xl border border-white/8 overflow-hidden">
      <div className="bg-white/5 px-4 py-3 flex items-center gap-2">
        <FlagImg url={lineup.team.flag_url} code={lineup.team.code} size="sm" />
        <span className="font-semibold text-sm text-cream">{lineup.team.name}</span>
      </div>

      <div className="p-3 space-y-1">
        {sorted.map(lp => <PlayerRow key={lp.player.id} lp={lp} isStarter />)}

        {lineup.substitutes.length > 0 && (
          <>
            <div className="border-t border-white/5 pt-2 mt-2">
              <p className="text-[10px] tracking-widest text-cream/20 uppercase px-2 mb-1">Substitutes</p>
            </div>
            {lineup.substitutes.map(lp => <PlayerRow key={lp.player.id} lp={lp} isStarter={false} />)}
          </>
        )}
      </div>
    </div>
  )
}

function PlayerRow({ lp, isStarter }: { lp: LineupPlayer; isStarter: boolean }) {
  return (
    <Link
      href={`/player/${lp.player.id}`}
      className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-white/5 transition-colors group"
    >
      <span className="w-5 text-xs text-cream/30 text-right font-mono tabular-nums shrink-0">
        {lp.shirt_number ?? lp.player.shirt_number ?? ''}
      </span>

      <PositionBadge pos={lp.position_played ?? lp.player.position} />

      <span className="flex-1 text-sm text-cream/80 group-hover:text-cream transition-colors truncate">
        {lp.player.name}
      </span>

      {lp.subbed_off_minute && (
        <span className="text-[11px] text-orange-400/70 shrink-0">
          ↓{lp.subbed_off_minute}'
        </span>
      )}
      {lp.subbed_on_minute && (
        <span className="text-[11px] text-green-400/70 shrink-0">
          ↑{lp.subbed_on_minute}'
        </span>
      )}

      {lp.player.club && (
        <span className="hidden sm:block text-[11px] text-cream/20 shrink-0 truncate max-w-[100px]">
          {lp.player.club.name}
        </span>
      )}
    </Link>
  )
}

function StatsTable({ stats }: { stats: PlayerMatchStats[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-white/5 text-cream/30">
          <th className="px-3 py-2 text-left font-medium">Player</th>
          <th className="px-2 py-2 text-center">Min</th>
          <th className="px-2 py-2 text-center">G</th>
          <th className="px-2 py-2 text-center">A</th>
          <th className="px-2 py-2 text-center">Sh</th>
          <th className="px-2 py-2 text-center">Pa%</th>
          <th className="px-2 py-2 text-center">Tk</th>
          <th className="px-2 py-2 text-center">🟨</th>
          <th className="px-2 py-2 text-center">🟥</th>
        </tr>
      </thead>
      <tbody>
        {stats.sort((a, b) => (b.is_starter ? 1 : 0) - (a.is_starter ? 1 : 0)).map(s => {
          const passAcc = s.passes_attempted > 0
            ? Math.round((s.passes_completed / s.passes_attempted) * 100)
            : null

          return (
            <tr key={s.player.id} className="border-b border-white/3 hover:bg-white/3 transition-colors">
              <td className="px-3 py-1.5">
                <Link href={`/player/${s.player.id}`} className="hover:text-gold transition-colors">
                  <span className={clsx('font-medium', s.is_starter ? 'text-cream/80' : 'text-cream/40')}>
                    {s.player.name}
                  </span>
                </Link>
              </td>
              <td className="px-2 py-1.5 text-center text-cream/40">{s.minutes_played}</td>
              <td className="px-2 py-1.5 text-center font-bold text-gold">{s.goals || ''}</td>
              <td className="px-2 py-1.5 text-center text-cream/60">{s.assists || ''}</td>
              <td className="px-2 py-1.5 text-center text-cream/40">{s.shots_total}</td>
              <td className="px-2 py-1.5 text-center text-cream/40">{passAcc !== null ? `${passAcc}%` : '—'}</td>
              <td className="px-2 py-1.5 text-center text-cream/40">{s.tackles_made}</td>
              <td className="px-2 py-1.5 text-center">{s.yellow_cards ? '🟨' : ''}</td>
              <td className="px-2 py-1.5 text-center">{s.red_cards ? '🟥' : ''}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function PositionBadge({ pos }: { pos: string | null }) {
  const colors: Record<string, string> = {
    GK:  'bg-yellow-500/20 text-yellow-400',
    DEF: 'bg-blue-500/20 text-blue-400',
    MID: 'bg-green-500/20 text-green-400',
    FWD: 'bg-red-500/20 text-red-400',
  }
  if (!pos) return null
  return (
    <span className={clsx(
      'shrink-0 rounded px-1 py-0.5 text-[10px] font-bold leading-none',
      colors[pos] ?? 'bg-white/10 text-cream/40'
    )}>
      {pos}
    </span>
  )
}

function FlagImg({ url, code, size }: { url: string | null; code: string; size: 'sm' | 'lg' }) {
  const dims = size === 'lg' ? { w: 80, h: 54, cls: 'h-14 w-20 rounded-md' }
                             : { w: 32, h: 22, cls: 'h-5 w-8 rounded' }
  if (!url) return <span className={clsx(dims.cls, 'bg-white/10 inline-block')} />
  return (
    <Image src={url} alt={code} width={dims.w} height={dims.h}
      className={clsx(dims.cls, 'object-cover shrink-0')} unoptimized />
  )
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display text-2xl font-bold text-cream mb-4">
      {children}
    </h2>
  )
}

function MatchSkeleton() {
  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-pulse">
      <div className="h-60 rounded-2xl bg-white/5" />
      <div className="grid md:grid-cols-2 gap-6">
        <div className="h-80 rounded-xl bg-white/5" />
        <div className="h-80 rounded-xl bg-white/5" />
      </div>
    </div>
  )
}
