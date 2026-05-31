import Image from 'next/image'
import Link from 'next/link'
import { GroupStandings, StandingRow } from '@/lib/types'
import clsx from 'clsx'

export function GroupTable({ group }: { group: GroupStandings }) {
  return (
    <div className="panel hover-lift overflow-hidden rounded-2xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-white/5 bg-gradient-to-r from-navy-700/60 to-navy-800/40 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-gold-gradient font-display text-lg text-ink shadow-gold">
            {group.group_name}
          </span>
          <div>
            <div className="font-display text-base tracking-widest text-cream">GROUP {group.group_name}</div>
            <div className="text-[10px] font-semibold tracking-[0.25em] text-cream/40">STANDINGS</div>
          </div>
        </div>
      </div>

      {/* Column header
          Portrait phone:  # Team P W D L Pts                 (7 cells)
          Landscape phone / tablet+: # Team P W D L GF GA Pts (9 cells)
       */}
      <div className="grid grid-cols-[22px_1fr_repeat(5,minmax(0,22px))] items-center gap-1 border-b border-white/5 bg-white/[0.02] px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-cream/40 landscape:grid-cols-[28px_1fr_repeat(7,minmax(0,28px))] sm:grid-cols-[28px_1fr_repeat(7,minmax(0,28px))]">
        <span className="text-center">#</span>
        <span>Team</span>
        <span className="text-center">P</span>
        <span className="text-center">W</span>
        <span className="text-center">D</span>
        <span className="text-center">L</span>
        <span className="hidden text-center landscape:block sm:block">GF</span>
        <span className="hidden text-center landscape:block sm:block">GA</span>
        <span className="text-center text-gold">PTS</span>
      </div>

      {/* Rows */}
      <div>
        {group.rows.map((row, i) => (
          <StandingRowItem key={row.team.id} row={row} rank={i + 1} />
        ))}
      </div>

      {/* Footer legend */}
      <div className="border-t border-white/5 bg-black/20 px-4 py-2.5 flex items-center gap-4 text-[10px] text-cream/40">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-3 rounded-sm bg-gold" />
          <span>Advance to KO</span>
        </span>
      </div>
    </div>
  )
}

function StandingRowItem({ row, rank }: { row: StandingRow; rank: number }) {
  const qualifies = rank <= 2

  return (
    <Link
      href={`/team/${row.team.id}`}
      className={clsx(
        'group/row relative grid grid-cols-[22px_1fr_repeat(5,minmax(0,22px))] items-center gap-1 px-3 py-2.5 text-sm transition-colors landscape:grid-cols-[28px_1fr_repeat(7,minmax(0,28px))] sm:grid-cols-[28px_1fr_repeat(7,minmax(0,28px))]',
        'hover:bg-white/[0.04]',
        qualifies ? '' : 'opacity-75'
      )}
    >
      {/* Left qualification stripe */}
      <span className={clsx(
        'absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r',
        qualifies ? 'bg-gold' : 'bg-transparent'
      )} />

      {/* Rank */}
      <span className={clsx(
        'flex h-5 w-5 items-center justify-center rounded text-[11px] font-bold tabular-nums',
        rank === 1 ? 'bg-gold text-ink' :
        rank === 2 ? 'bg-amber-500/30 text-amber-400' :
        'text-cream/40'
      )}>
        {rank}
      </span>

      {/* Team */}
      <div className="flex items-center gap-2.5 min-w-0">
        <Flag url={row.team.flag_url} code={row.team.code} />
        <span className="truncate text-sm font-semibold text-cream">
          {row.team.name}
        </span>
        {row.team.world_rank != null && (
          <span
            title={`FIFA world ranking #${row.team.world_rank}`}
            className="hidden shrink-0 rounded-sm bg-white/5 px-1 py-px font-mono text-[9px] font-bold text-amber-400/70 sm:inline"
          >
            #{row.team.world_rank}
          </span>
        )}
      </div>

      {/* Stats — L always visible; GF/GA only in landscape or tablet+ */}
      <span className="text-center font-mono text-xs text-cream/60 tabular-nums">{row.played}</span>
      <span className="text-center font-mono text-xs text-cream/60 tabular-nums">{row.won}</span>
      <span className="text-center font-mono text-xs text-cream/60 tabular-nums">{row.drawn}</span>
      <span className="text-center font-mono text-xs text-cream/60 tabular-nums">{row.lost}</span>
      <span className="hidden text-center font-mono text-xs text-cream/60 tabular-nums landscape:block sm:block">{row.goals_for}</span>
      <span className="hidden text-center font-mono text-xs text-cream/60 tabular-nums landscape:block sm:block">{row.goals_against}</span>
      <span className="text-center font-mono text-sm font-black text-gold tabular-nums">{row.points}</span>
    </Link>
  )
}

function Flag({ url, code }: { url: string | null; code: string }) {
  if (!url) {
    return (
      <span className="flex h-4 w-6 shrink-0 items-center justify-center rounded-sm bg-white/10 text-[9px] font-bold text-cream/50">
        {code}
      </span>
    )
  }
  return (
    <Image
      src={url}
      alt={code}
      width={24}
      height={16}
      className="h-4 w-6 shrink-0 rounded-sm object-cover ring-1 ring-black/40"
      unoptimized
    />
  )
}
