import Image from 'next/image'
import { GroupStandings, StandingRow } from '@/lib/types'
import clsx from 'clsx'

export function GroupTable({ group }: { group: GroupStandings }) {
  return (
    <div className="rounded-xl border border-white/8 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between bg-white/5 px-4 py-3">
        <h2 className="font-display text-lg font-bold text-gold tracking-wide">
          Group {group.group_name}
        </h2>
        <div className="grid grid-cols-4 gap-4 text-xs font-medium text-cream/30 text-center w-36">
          <span>P</span><span>W</span><span>D</span><span>Pts</span>
        </div>
      </div>

      {/* Rows */}
      <div className="divide-y divide-white/5">
        {group.rows.map((row, i) => (
          <StandingRowItem key={row.team.id} row={row} rank={i + 1} />
        ))}
      </div>
    </div>
  )
}

function StandingRowItem({ row, rank }: { row: StandingRow; rank: number }) {
  const qualifies = rank <= 2  // top 2 advance (simplified — 3rd place logic separate)

  return (
    <div className={clsx(
      'flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-white/3',
      qualifies ? '' : 'opacity-60'
    )}>
      <div className="flex items-center gap-3 flex-1 min-w-0">
        {/* Rank indicator */}
        <span className={clsx(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold',
          rank === 1 ? 'bg-gold text-carbon' :
          rank === 2 ? 'bg-white/20 text-cream' :
          'text-cream/30'
        )}>
          {rank}
        </span>

        {/* Flag */}
        {row.team.flag_url ? (
          <Image
            src={row.team.flag_url}
            alt={row.team.code}
            width={28}
            height={19}
            className="rounded shrink-0 object-cover"
            unoptimized
          />
        ) : (
          <span className="h-5 w-7 rounded bg-white/10 shrink-0" />
        )}

        {/* Name */}
        <span className="text-sm font-medium text-cream truncate">
          {row.team.name}
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 text-xs text-center w-36 shrink-0">
        <span className="text-cream/50">{row.played}</span>
        <span className="text-cream/50">{row.won}</span>
        <span className="text-cream/50">{row.drawn}</span>
        <span className="font-bold text-cream">{row.points}</span>
      </div>
    </div>
  )
}
