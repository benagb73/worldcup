'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import clsx from 'clsx'
import { useLeaderboard } from '@/lib/hooks'
import { LeaderboardRow } from '@/lib/types'

type Direction = 'desc' | 'asc'

interface ColumnDef {
  key: string
  label: string
  short: string
  numeric: boolean
  defaultDir: Direction
  // How to extract sort value from a row (derived columns supported)
  value: (r: LeaderboardRow) => number | string
  // How to render the cell
  render?: (r: LeaderboardRow) => React.ReactNode
  // Override classes for the cell
  cellClass?: string
  // Eyebrow color for the header
  headerClass?: string
}

// Derived percentages — return -1 if undefined so they sort last in desc
const passAcc = (r: LeaderboardRow) =>
  r.passes_attempted > 0 ? (r.passes_completed / r.passes_attempted) * 100 : -1
const shotAcc = (r: LeaderboardRow) =>
  r.shots_total > 0 ? (r.shots_on_target / r.shots_total) * 100 : -1

const COLUMNS: ColumnDef[] = [
  { key: 'apps',          label: 'Apps',     short: 'APP',  numeric: true, defaultDir: 'desc', value: r => r.apps },
  { key: 'minutes_played', label: 'Minutes',  short: 'MIN',  numeric: true, defaultDir: 'desc', value: r => r.minutes_played },
  { key: 'goals',         label: 'Goals',    short: 'G',    numeric: true, defaultDir: 'desc', value: r => r.goals,
    headerClass: 'text-gold' },
  { key: 'assists',       label: 'Assists',  short: 'A',    numeric: true, defaultDir: 'desc', value: r => r.assists,
    headerClass: 'text-emerald-400' },
  { key: 'shots_total',   label: 'Shots',    short: 'SH',   numeric: true, defaultDir: 'desc', value: r => r.shots_total },
  { key: 'shots_on_target', label: 'On Tgt', short: 'SOT',  numeric: true, defaultDir: 'desc', value: r => r.shots_on_target },
  { key: 'shot_acc',      label: 'Shot %',   short: 'SH%',  numeric: true, defaultDir: 'desc',
    value: shotAcc,
    render: r => (r.shots_total > 0 ? `${Math.round(shotAcc(r))}%` : '–') },
  { key: 'passes_completed', label: 'Pass Comp', short: 'PC', numeric: true, defaultDir: 'desc', value: r => r.passes_completed },
  { key: 'pass_acc',      label: 'Pass %',   short: 'PS%',  numeric: true, defaultDir: 'desc',
    value: passAcc,
    render: r => (r.passes_attempted > 0 ? `${Math.round(passAcc(r))}%` : '–') },
  { key: 'tackles_made',  label: 'Tackles',  short: 'TKL',  numeric: true, defaultDir: 'desc', value: r => r.tackles_made },
  { key: 'fouls_won',     label: 'Fouls Won', short: 'F+',  numeric: true, defaultDir: 'desc', value: r => r.fouls_won },
  { key: 'fouls_committed', label: 'Fouls Cmt', short: 'F-', numeric: true, defaultDir: 'desc', value: r => r.fouls_committed },
  { key: 'yellow_cards',  label: 'Yellows',  short: 'Y',    numeric: true, defaultDir: 'desc', value: r => r.yellow_cards },
  { key: 'red_cards',     label: 'Reds',     short: 'R',    numeric: true, defaultDir: 'desc', value: r => r.red_cards },
  { key: 'saves',         label: 'Saves',    short: 'SV',   numeric: true, defaultDir: 'desc', value: r => r.saves },
  { key: 'goals_conceded', label: 'Conceded', short: 'GA',  numeric: true, defaultDir: 'desc', value: r => r.goals_conceded },
]

export default function LeaderboardPage() {
  const { data, isLoading } = useLeaderboard()
  const [sortKey, setSortKey] = useState<string>('minutes_played')
  const [direction, setDirection] = useState<Direction>('desc')
  const [posFilter, setPosFilter] = useState<'ALL' | 'GK' | 'DEF' | 'MID' | 'FWD'>('ALL')

  const sortDef = useMemo(() => COLUMNS.find(c => c.key === sortKey)!, [sortKey])

  const sorted: LeaderboardRow[] = useMemo(() => {
    if (!data) return []
    const filtered = posFilter === 'ALL'
      ? data
      : data.filter((r: LeaderboardRow) => r.position === posFilter)
    const arr = [...filtered]
    arr.sort((a, b) => {
      const va = sortDef.value(a)
      const vb = sortDef.value(b)
      if (typeof va === 'number' && typeof vb === 'number') {
        return direction === 'desc' ? vb - va : va - vb
      }
      return direction === 'desc'
        ? String(vb).localeCompare(String(va))
        : String(va).localeCompare(String(vb))
    })
    return arr
  }, [data, sortKey, direction, posFilter, sortDef])

  function clickHeader(col: ColumnDef) {
    if (col.key === sortKey) {
      // Toggle direction
      setDirection(d => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(col.key)
      setDirection(col.defaultDir)
    }
  }

  if (isLoading) return <Skeleton />

  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl border border-white/10 panel">
        <div className="absolute inset-0 opacity-60">
          <div className="absolute -top-32 left-1/4 h-72 w-72 rounded-full bg-amber-500/20 blur-3xl" />
        </div>
        <div className="relative px-6 py-10 sm:px-10 sm:py-12">
          <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">DATA</div>
          <h1 className="mt-1 font-display text-5xl tracking-tight text-cream sm:text-6xl">
            PLAYER <span className="text-gold-gradient">LEADERBOARD</span>
          </h1>
          <p className="mt-3 max-w-xl text-sm text-cream/50">
            Tournament totals for every player with at least one minute played. Click any column header to sort —
            click again to reverse.
          </p>
        </div>
      </section>

      {/* Filter pills */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-bold tracking-widest text-cream/40">POSITION</span>
        {(['ALL', 'GK', 'DEF', 'MID', 'FWD'] as const).map(p => (
          <button
            key={p}
            onClick={() => setPosFilter(p)}
            className={clsx(
              'rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-widest transition-colors',
              posFilter === p
                ? 'border-amber-400/50 bg-amber-500/10 text-amber-400'
                : 'border-white/10 text-cream/50 hover:text-cream hover:border-white/20'
            )}
          >
            {p}
          </button>
        ))}
        <span className="ml-auto text-[10px] font-bold tracking-widest text-cream/40">
          {sorted.length} {sorted.length === 1 ? 'PLAYER' : 'PLAYERS'}
        </span>
      </div>

      {sorted.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-white/10 panel py-12 text-center text-sm text-cream/50">
          No player has logged any minutes yet. Stats appear here as soon as a lineup with minutes is recorded.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/10 panel">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-sm">
              <thead className="bg-black/30">
                <tr className="text-[10px] font-bold tracking-widest text-cream/40">
                  <th className="px-3 py-2 text-left sticky left-0 z-10 bg-black/40">RANK</th>
                  <th className="px-3 py-2 text-left sticky left-12 z-10 bg-black/40 min-w-[200px]">PLAYER</th>
                  <th className="px-3 py-2 text-left">POS</th>
                  {COLUMNS.map(c => (
                    <th key={c.key} className="px-2 py-2 text-center whitespace-nowrap">
                      <button
                        onClick={() => clickHeader(c)}
                        className={clsx(
                          'inline-flex items-center gap-1 transition-colors hover:text-cream',
                          sortKey === c.key ? 'text-amber-400' : (c.headerClass ?? 'text-cream/40')
                        )}
                        title={c.label}
                      >
                        {c.short}
                        {sortKey === c.key && (
                          <span className="text-amber-400">{direction === 'desc' ? '↓' : '↑'}</span>
                        )}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {sorted.map((row, i) => (
                  <PlayerRow key={row.player_id} row={row} rank={i + 1} sortKey={sortKey} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function PlayerRow({ row, rank, sortKey }: { row: LeaderboardRow; rank: number; sortKey: string }) {
  return (
    <tr className="transition-colors hover:bg-white/[0.03]">
      <td className="px-3 py-2 text-center font-mono text-xs text-cream/40 sticky left-0 z-10 bg-ink/95">
        {rank}
      </td>
      <td className="px-3 py-2 sticky left-12 z-10 bg-ink/95">
        <div className="flex items-center gap-2.5 min-w-0">
          <Link href={`/team/${row.team_id}`} className="shrink-0" title={row.team_name}>
            {row.flag_url ? (
              <Image src={row.flag_url} alt={row.team_code} width={20} height={14}
                     className="h-3.5 w-5 rounded-sm object-cover ring-1 ring-black/40 transition-transform hover:scale-110"
                     unoptimized />
            ) : (
              <span className="h-3.5 w-5 block rounded-sm bg-white/10 ring-1 ring-black/40" />
            )}
          </Link>
          <Link
            href={`/player/${row.player_id}`}
            className="truncate text-sm font-semibold text-cream hover:text-gold transition-colors"
          >
            {row.player_name}
          </Link>
          <Link
            href={`/team/${row.team_id}`}
            className="ml-1 font-mono text-[10px] text-cream/40 hover:text-amber-400"
          >
            {row.team_code}
          </Link>
        </div>
      </td>
      <td className="px-3 py-2">
        <PositionBadge pos={row.position} />
      </td>
      {COLUMNS.map(c => {
        const raw = c.value(row)
        const rendered = c.render ? c.render(row) : (typeof raw === 'number' && raw <= 0 ? '–' : raw)
        const isActive = sortKey === c.key
        return (
          <td
            key={c.key}
            className={clsx(
              'px-2 py-2 text-center font-mono text-xs tabular-nums whitespace-nowrap',
              isActive ? 'text-amber-400 font-bold' :
              c.key === 'goals' && row.goals > 0 ? 'text-gold font-bold' :
              c.key === 'assists' && row.assists > 0 ? 'text-emerald-400 font-bold' :
              c.key === 'red_cards' && row.red_cards > 0 ? 'text-live font-bold' :
              c.key === 'yellow_cards' && row.yellow_cards > 0 ? 'text-amber-400/80' :
              'text-cream/60'
            )}
          >
            {rendered}
          </td>
        )
      })}
    </tr>
  )
}

function PositionBadge({ pos }: { pos: string | null }) {
  if (!pos) return <span className="text-cream/30 text-xs">—</span>
  const map: Record<string, string> = {
    GK:  'bg-amber-400/15 text-amber-400 ring-amber-400/30',
    DEF: 'bg-blue-400/15 text-blue-400 ring-blue-400/30',
    MID: 'bg-emerald-400/15 text-emerald-400 ring-emerald-400/30',
    FWD: 'bg-rose-400/15 text-rose-400 ring-rose-400/30',
  }
  return (
    <span className={clsx(
      'rounded px-1.5 py-0.5 text-[10px] font-bold tracking-widest ring-1',
      map[pos] ?? 'bg-white/10 text-cream/50 ring-white/10'
    )}>
      {pos}
    </span>
  )
}

function Skeleton() {
  return (
    <div className="space-y-8">
      <div className="h-48 rounded-3xl shimmer" />
      <div className="h-10 rounded-full shimmer" />
      <div className="h-96 rounded-2xl shimmer" />
    </div>
  )
}
