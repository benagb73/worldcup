'use client'

import { use } from 'react'
import { usePlayer, usePlayerStats } from '@/lib/hooks'
import { PlayerMatchStats } from '@/lib/types'
import { calculateAge } from '@/lib/utils'
import Link from 'next/link'
import clsx from 'clsx'

const POS_STYLES: Record<string, string> = {
  GK:  'from-amber-400/30 to-amber-500/10 text-amber-400 border-amber-400/40',
  DEF: 'from-blue-400/30 to-blue-500/10 text-blue-400 border-blue-400/40',
  MID: 'from-emerald-400/30 to-emerald-500/10 text-emerald-400 border-emerald-400/40',
  FWD: 'from-rose-400/30 to-rose-500/10 text-rose-400 border-rose-400/40',
}

export default function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: player, isLoading: pLoading } = usePlayer(id)
  const { data: stats,  isLoading: sLoading } = usePlayerStats(id)

  if (pLoading || sLoading) return <Skeleton />
  if (!player) return <div className="text-center text-cream/40 py-20">Player not found</div>

  const totals = (stats ?? []).reduce(
    (acc: any, s: PlayerMatchStats) => ({
      apps:       acc.apps       + 1,
      mins:       acc.mins       + s.minutes_played,
      goals:      acc.goals      + s.goals,
      assists:    acc.assists    + s.assists,
      shots:      acc.shots      + s.shots_total,
      shotsOT:    acc.shotsOT    + s.shots_on_target,
      passes:     acc.passes     + s.passes_completed,
      passAtt:    acc.passAtt    + s.passes_attempted,
      tackles:    acc.tackles    + s.tackles_made,
      foulsC:     acc.foulsC     + (s.fouls_committed ?? 0),
      foulsW:     acc.foulsW     + (s.fouls_won ?? 0),
      yellows:    acc.yellows    + s.yellow_cards,
      reds:       acc.reds       + s.red_cards,
      saves:      acc.saves      + s.saves,
      conceded:   acc.conceded   + s.goals_conceded,
    }),
    { apps: 0, mins: 0, goals: 0, assists: 0, shots: 0, shotsOT: 0,
      passes: 0, passAtt: 0, tackles: 0, foulsC: 0, foulsW: 0,
      yellows: 0, reds: 0, saves: 0, conceded: 0 }
  )

  const passAcc = totals.passAtt > 0 ? Math.round((totals.passes / totals.passAtt) * 100) : null
  const shotAcc = totals.shots > 0 ? Math.round((totals.shotsOT / totals.shots) * 100) : null
  const isGK = player.position === 'GK'

  return (
    <div className="space-y-10">
      <Link
        href="/"
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-cream/60 transition-colors hover:border-amber-400/30 hover:text-gold"
      >
        ← Back
      </Link>

      {/* Profile hero */}
      <section className="relative overflow-hidden rounded-3xl border border-white/10 panel">
        <div className="absolute inset-0 opacity-60">
          <div className="absolute -top-32 -left-32 h-72 w-72 rounded-full bg-amber-500/15 blur-3xl" />
          <div className="absolute -bottom-32 -right-20 h-72 w-72 rounded-full bg-navy-500/30 blur-3xl" />
        </div>

        <div className="relative px-6 py-10 sm:px-10 sm:py-12">
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
            {/* Shirt number badge */}
            <div className="relative">
              <div className={clsx(
                'relative flex h-28 w-28 items-center justify-center rounded-2xl border bg-gradient-to-br shadow-2xl',
                POS_STYLES[player.position ?? ''] ?? 'from-white/10 to-white/5 text-cream border-white/20'
              )}>
                <span className="font-display text-6xl leading-none tracking-tight">
                  {player.shirt_number ?? '?'}
                </span>
              </div>
              <div className="absolute -inset-2 -z-10 rounded-2xl bg-amber-500/20 blur-xl" />
            </div>

            {/* Info */}
            <div className="flex-1 text-center sm:text-left">
              <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">
                {player.club?.country?.toUpperCase() ?? 'PLAYER'}
              </div>
              <h1 className="mt-1 font-display text-4xl leading-none tracking-wide text-cream sm:text-5xl">
                {player.name.toUpperCase()}
              </h1>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                {player.position && (
                  <span className={clsx(
                    'rounded-full border px-2.5 py-1 text-[10px] font-bold tracking-widest',
                    POS_STYLES[player.position] ?? 'border-white/10 text-cream/60'
                  )}>
                    {player.position}
                  </span>
                )}
                {player.club && (
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] font-bold tracking-widest text-cream/60">
                    {player.club.name.toUpperCase()}
                  </span>
                )}
                {player.club?.league && (
                  <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] font-bold tracking-widest text-cream/60">
                    {player.club.league.toUpperCase()} · {player.club.country.toUpperCase()}
                  </span>
                )}
                {!player.club && player.club_status === 'unattached' && (
                  <span className="rounded-full border border-cream/15 bg-white/5 px-2.5 py-1 text-[10px] font-bold tracking-widest text-cream/60">
                    FREE AGENT
                  </span>
                )}
                {!player.club && player.club_status === 'unknown' && (
                  <span className="rounded-full border border-amber-400/20 bg-amber-500/5 px-2.5 py-1 text-[10px] font-bold tracking-widest text-amber-400/70">
                    CLUB UNKNOWN
                  </span>
                )}
                {player.date_of_birth && (() => {
                  const age = calculateAge(player.date_of_birth)
                  return age !== null && (
                    <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 text-[10px] font-bold tracking-widest text-cream/60">
                      AGE {age}
                    </span>
                  )
                })()}
              </div>
            </div>
          </div>
        </div>

        {/* Tournament stat grid — position-aware layout */}
        <div className="relative border-t border-white/5 bg-black/30 px-6 py-6 sm:px-10">
          <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400 mb-4">TOURNAMENT TOTALS</div>
          {isGK ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <StatBox label="Appearances" value={totals.apps} />
              <StatBox label="Minutes"     value={totals.mins} />
              <StatBox label="Saves"       value={totals.saves}    highlight={totals.saves > 0} />
              <StatBox label="Conceded"    value={totals.conceded} danger={totals.conceded > 0} />
              <StatBox label="Goals"       value={totals.goals}    highlight={totals.goals > 0} />
              <StatBox label="Assists"     value={totals.assists}  highlight={totals.assists > 0} />
              <StatBox label="Fouls Won"   value={totals.foulsW} />
              <StatBox label="Fouls Cmt"   value={totals.foulsC} />
              <StatBox label="Yellow Cards" value={totals.yellows}  warn={totals.yellows > 0} />
              <StatBox label="Red Cards"    value={totals.reds}     danger={totals.reds > 0} />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
              <StatBox label="Appearances" value={totals.apps} />
              <StatBox label="Minutes"     value={totals.mins} />
              <StatBox label="Goals"       value={totals.goals}    highlight={totals.goals > 0} />
              <StatBox label="Assists"     value={totals.assists}  highlight={totals.assists > 0} />
              <StatBox label="Tackles"     value={totals.tackles} />
              <StatBox label="Fouls Won"   value={totals.foulsW} />
              <StatBox label="Fouls Cmt"   value={totals.foulsC} />
              <StatBox label="Yellow Cards" value={totals.yellows}  warn={totals.yellows > 0} />
              <StatBox label="Red Cards"    value={totals.reds}     danger={totals.reds > 0} />
              <StatBox
                label="Total Passes"
                value={totals.passAtt}
                sublabel={totals.passes > 0 ? `${totals.passes} done` : undefined}
              />
              <StatBox
                label="Pass Acc"
                value={passAcc !== null ? `${passAcc}%` : '—'}
                highlight={passAcc !== null && passAcc >= 85}
              />
              <StatBox
                label="Shots"
                value={totals.shots}
                sublabel={totals.shotsOT > 0 ? `${totals.shotsOT} on tgt` : undefined}
              />
              <StatBox
                label="Shot Acc"
                value={shotAcc !== null ? `${shotAcc}%` : '—'}
                highlight={shotAcc !== null && shotAcc >= 50}
              />
            </div>
          )}
        </div>
      </section>

      {/* Match log */}
      {stats && stats.length > 0 && (
        <section>
          <div className="mb-5">
            <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">PER MATCH</div>
            <h2 className="font-display text-3xl tracking-wide text-cream">Match Log</h2>
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/10 panel">
            <div className="hidden sm:grid grid-cols-[40px_1fr_repeat(6,minmax(0,52px))] items-center gap-2 border-b border-white/5 bg-black/30 px-4 py-2.5 text-[10px] font-bold tracking-widest text-cream/40">
              <span className="text-center">#</span>
              <span>ROLE</span>
              <span className="text-center">MIN</span>
              <span className="text-center">G</span>
              <span className="text-center">A</span>
              <span className="text-center">SH</span>
              <span className="text-center">Y/R</span>
              {isGK ? <span className="text-center text-amber-400">SV</span> : <span />}
            </div>
            <div className="divide-y divide-white/5">
              {(stats as PlayerMatchStats[]).map((s, i) => (
                <div
                  key={i}
                  className="grid grid-cols-[40px_1fr_repeat(6,minmax(0,52px))] items-center gap-2 px-4 py-3 text-sm transition-colors hover:bg-white/[0.04]"
                >
                  <span className="text-center font-mono text-xs text-cream/40">{i + 1}</span>
                  <span className={clsx(
                    'rounded px-2 py-0.5 text-[10px] font-bold tracking-widest w-fit',
                    s.is_starter ? 'bg-amber-400/15 text-amber-400' : 'bg-white/5 text-cream/40'
                  )}>
                    {s.is_starter ? 'STARTER' : 'SUB'}
                  </span>
                  <span className="text-center font-mono text-xs text-cream/70">{s.minutes_played}'</span>
                  <span className={clsx('text-center font-mono text-sm font-bold', s.goals > 0 ? 'text-amber-400' : 'text-cream/30')}>
                    {s.goals || '–'}
                  </span>
                  <span className={clsx('text-center font-mono text-sm', s.assists > 0 ? 'text-emerald-400 font-bold' : 'text-cream/30')}>
                    {s.assists || '–'}
                  </span>
                  <span className="text-center font-mono text-xs text-cream/60">{s.shots_total || '–'}</span>
                  <span className="text-center text-xs">
                    {s.yellow_cards > 0 && <span className="inline-block h-3 w-2 rounded-sm bg-amber-400" />}
                    {s.red_cards > 0 && <span className="inline-block h-3 w-2 ml-0.5 rounded-sm bg-live" />}
                    {!s.yellow_cards && !s.red_cards && <span className="text-cream/20">–</span>}
                  </span>
                  {isGK ? <span className="text-center font-mono text-xs text-cream/70">{s.saves}</span> : <span />}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function StatBox({ label, value, sublabel, highlight, warn, danger }: {
  label: string; value: number | string; sublabel?: string;
  highlight?: boolean; warn?: boolean; danger?: boolean
}) {
  return (
    <div className={clsx(
      'relative overflow-hidden rounded-xl border p-3.5 text-center transition-colors',
      highlight ? 'border-amber-400/30 bg-amber-500/5' :
      warn      ? 'border-amber-400/30 bg-amber-500/5' :
      danger    ? 'border-live/30 bg-live/5' :
      'border-white/10 bg-white/[0.03]'
    )}>
      <div className={clsx(
        'font-display text-3xl leading-none tracking-tight tabular-nums sm:text-4xl',
        highlight ? 'text-gold-gradient' :
        warn      ? 'text-amber-400' :
        danger    ? 'text-live' :
        'text-cream'
      )}>
        {value}
      </div>
      {sublabel && <div className="mt-1 text-[10px] font-mono text-cream/40">{sublabel}</div>}
      <div className="mt-1 text-[10px] font-bold tracking-widest text-cream/40">{label.toUpperCase()}</div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-8">
      <div className="h-7 w-24 rounded-full shimmer" />
      <div className="h-72 rounded-3xl shimmer" />
      <div className="h-96 rounded-2xl shimmer" />
    </div>
  )
}
