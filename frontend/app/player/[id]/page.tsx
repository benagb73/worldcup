'use client'

import { usePlayer, usePlayerStats } from '@/lib/hooks'
import { PlayerMatchStats } from '@/lib/types'
import Image from 'next/image'
import Link from 'next/link'
import clsx from 'clsx'

const POS_COLOR: Record<string, string> = {
  GK:  'text-yellow-400 border-yellow-400/30',
  DEF: 'text-blue-400   border-blue-400/30',
  MID: 'text-green-400  border-green-400/30',
  FWD: 'text-red-400    border-red-400/30',
}

export default function PlayerPage({ params }: { params: { id: string } }) {
  const { data: player, isLoading: pLoading } = usePlayer(params.id)
  const { data: stats,  isLoading: sLoading } = usePlayerStats(params.id)

  if (pLoading || sLoading) return <Skeleton />
  if (!player) return <div className="text-center text-cream/40 py-20">Player not found</div>

  // Tournament totals
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
      yellows:    acc.yellows    + s.yellow_cards,
      reds:       acc.reds       + s.red_cards,
      saves:      acc.saves      + s.saves,
      conceded:   acc.conceded   + s.goals_conceded,
    }),
    { apps: 0, mins: 0, goals: 0, assists: 0, shots: 0, shotsOT: 0,
      passes: 0, passAtt: 0, tackles: 0, yellows: 0, reds: 0, saves: 0, conceded: 0 }
  )

  const passAcc = totals.passAtt > 0
    ? Math.round((totals.passes / totals.passAtt) * 100)
    : null

  const isGK = player.position === 'GK'

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <Link href="/" className="inline-flex items-center gap-2 text-sm text-cream/30 hover:text-gold transition-colors">
        ← Back
      </Link>

      {/* Profile card */}
      <div className="rounded-2xl border border-white/10 bg-white/3 overflow-hidden">
        <div className="pitch-bg px-6 py-8">
          <div className="flex items-start gap-6">
            {/* Flag + number */}
            <div className="flex flex-col items-center gap-3">
              {player.club?.name ? (
                <div className="h-16 w-16 rounded-full bg-white/10 flex items-center justify-center text-xl font-black text-cream/30">
                  {player.shirt_number ?? '?'}
                </div>
              ) : (
                <div className="h-16 w-16 rounded-full bg-white/10 flex items-center justify-center text-xl font-black text-cream/30">
                  {player.shirt_number ?? '?'}
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="font-display text-3xl font-black text-cream">
                  {player.name}
                </h1>
                {player.position && (
                  <span className={clsx(
                    'rounded-full border px-3 py-1 text-xs font-bold',
                    POS_COLOR[player.position] ?? 'text-cream/40 border-white/10'
                  )}>
                    {player.position}
                  </span>
                )}
              </div>

              {player.club && (
                <div className="mt-3 flex flex-wrap gap-4">
                  <InfoPill label="Club" value={player.club.name} />
                  <InfoPill label="League" value={player.club.league} />
                  <InfoPill label="Country" value={player.club.country} />
                </div>
              )}

              {player.date_of_birth && (
                <div className="mt-2">
                  <InfoPill label="DOB" value={player.date_of_birth} />
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Tournament totals */}
        <div className="border-t border-white/5 px-6 py-5">
          <h2 className="text-xs tracking-widest text-cream/30 uppercase mb-4">
            Tournament Stats
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <StatBox label="Apps"    value={totals.apps} />
            <StatBox label="Minutes" value={totals.mins} />
            <StatBox label="Goals"   value={totals.goals}   highlight={totals.goals > 0} />
            <StatBox label="Assists" value={totals.assists}  highlight={totals.assists > 0} />
            <StatBox label="Shots"   value={totals.shots} />
            <StatBox label="On Target" value={totals.shotsOT} />
            <StatBox label="Pass Acc" value={passAcc !== null ? `${passAcc}%` : '—'} />
            <StatBox label="Tackles" value={totals.tackles} />
            {totals.yellows > 0 && <StatBox label="Yellows" value={totals.yellows} warn />}
            {totals.reds    > 0 && <StatBox label="Reds"    value={totals.reds}    danger />}
            {isGK && <StatBox label="Saves"    value={totals.saves} />}
            {isGK && <StatBox label="Conceded" value={totals.conceded} />}
          </div>
        </div>
      </div>

      {/* Match-by-match */}
      {stats && stats.length > 0 && (
        <section>
          <h2 className="font-display text-2xl font-bold text-cream mb-4">
            Match Log
          </h2>
          <div className="space-y-3">
            {(stats as PlayerMatchStats[]).map((s, i) => (
              <div key={i} className="rounded-xl border border-white/8 bg-white/3 px-4 py-3 flex items-center gap-4 flex-wrap">
                <span className="text-xs text-cream/30 font-medium w-6">{i + 1}</span>
                <span className={clsx('text-xs rounded px-2 py-0.5',
                  s.is_starter ? 'bg-gold/10 text-gold' : 'bg-white/5 text-cream/30')}>
                  {s.is_starter ? 'Starter' : 'Sub'}
                </span>
                <span className="text-xs text-cream/30 font-mono">{s.minutes_played}'</span>
                {s.goals   > 0 && <span className="text-xs">⚽ {s.goals}</span>}
                {s.assists > 0 && <span className="text-xs text-cream/60">🎯 {s.assists}</span>}
                {s.yellow_cards > 0 && <span>🟨</span>}
                {s.red_cards    > 0 && <span>🟥</span>}
                {isGK && s.saves > 0 && (
                  <span className="text-xs text-blue-400">{s.saves} saves</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs text-cream/30">{label}:</span>
      <span className="text-xs font-medium text-cream/70">{value}</span>
    </div>
  )
}

function StatBox({ label, value, highlight, warn, danger }: {
  label: string; value: number | string;
  highlight?: boolean; warn?: boolean; danger?: boolean
}) {
  return (
    <div className="rounded-lg bg-white/5 p-3 text-center">
      <div className={clsx(
        'text-2xl font-black font-mono',
        highlight ? 'text-gold' :
        warn      ? 'text-yellow-400' :
        danger    ? 'text-red-400' :
        'text-cream'
      )}>
        {value}
      </div>
      <div className="text-[10px] tracking-widest text-cream/30 uppercase mt-1">{label}</div>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-pulse">
      <div className="h-48 rounded-2xl bg-white/5" />
      <div className="grid grid-cols-4 gap-4">
        {[1,2,3,4].map(i => <div key={i} className="h-20 rounded-lg bg-white/5" />)}
      </div>
    </div>
  )
}
