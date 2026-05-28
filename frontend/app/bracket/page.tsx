'use client'

import { useBracket } from '@/lib/hooks'
import { BracketSlot } from '@/lib/types'
import { displayScore, stageName } from '@/lib/utils'
import Image from 'next/image'
import Link from 'next/link'
import clsx from 'clsx'

const STAGE_ORDER = ['r32', 'r16', 'qf', 'sf', 'final']

export default function BracketPage() {
  const { data: slots, isLoading } = useBracket()

  if (isLoading) return (
    <div className="space-y-8 animate-pulse">
      <div className="h-8 w-48 rounded bg-white/5" />
      {[1, 2, 3].map(i => (
        <div key={i}>
          <div className="h-5 w-32 rounded bg-white/5 mb-3" />
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2].map(j => <div key={j} className="h-20 rounded-xl bg-white/5" />)}
          </div>
        </div>
      ))}
    </div>
  )

  const byStage: Record<string, BracketSlot[]> = {}
  for (const s of slots ?? []) {
    byStage[s.stage] = [...(byStage[s.stage] ?? []), s]
  }

  return (
    <div className="space-y-12">
      <div>
        <h1 className="font-display text-4xl font-black text-cream">Knockout Stage</h1>
        <p className="mt-1 text-sm text-cream/30">Bracket updates as teams advance</p>
      </div>

      {STAGE_ORDER.filter(s => byStage[s]?.length).map(stage => (
        <section key={stage}>
          <h2 className="mb-4 font-display text-xl font-bold text-gold tracking-wide">
            {stageName(stage)}
          </h2>
          <div className={clsx(
            'grid gap-3',
            stage === 'final' ? 'max-w-md' :
            stage === 'sf'    ? 'md:grid-cols-2 max-w-2xl' :
            stage === 'qf'    ? 'md:grid-cols-2 lg:grid-cols-2' :
            'md:grid-cols-2 lg:grid-cols-3'
          )}>
            {byStage[stage].map(slot => (
              <BracketCard key={slot.slot} slot={slot} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function BracketCard({ slot }: { slot: BracketSlot }) {
  const hasBoth = slot.home_team && slot.away_team
  const m = slot.match
  const { home, away, suffix } = m ? displayScore(m) : { home: null, away: null, suffix: '' }
  const isLive = m?.status.startsWith('live')

  const Wrapper = m ? Link : 'div'
  const wrapperProps = m ? { href: `/match/${m.id}` } : {}

  return (
    // @ts-ignore
    <Wrapper
      {...wrapperProps}
      className={clsx(
        'block rounded-xl border p-4 transition-all',
        m ? 'hover:border-gold/30 hover:-translate-y-0.5 cursor-pointer' : 'cursor-default',
        isLive ? 'border-gold/30 bg-gold/5' : 'border-white/8 bg-white/3'
      )}
    >
      <div className="flex items-center justify-between gap-3">
        {/* Home */}
        <TeamSlot
          team={slot.home_team}
          seed={slot.home_seed_desc}
          isWinner={m?.winner_id === slot.home_team?.id}
        />

        {/* Score or vs */}
        <div className="text-center shrink-0 min-w-[52px]">
          {home !== null && away !== null ? (
            <div>
              <div className={clsx(
                'font-mono text-xl font-black',
                isLive ? 'text-gold' : 'text-cream'
              )}>
                {home}–{away}
              </div>
              {suffix && <div className="text-[10px] text-gold/50 font-medium">{suffix}</div>}
            </div>
          ) : (
            <span className="text-sm font-mono text-cream/20">vs</span>
          )}
        </div>

        {/* Away */}
        <TeamSlot
          team={slot.away_team}
          seed={slot.away_seed_desc}
          isWinner={m?.winner_id === slot.away_team?.id}
          reverse
        />
      </div>
    </Wrapper>
  )
}

function TeamSlot({ team, seed, isWinner, reverse }: {
  team: any; seed: string | null; isWinner: boolean; reverse?: boolean
}) {
  return (
    <div className={clsx('flex flex-1 items-center gap-2 min-w-0', reverse ? 'flex-row-reverse' : '')}>
      {team ? (
        <>
          {team.flag_url ? (
            <Image src={team.flag_url} alt={team.code} width={28} height={19}
              className="h-5 w-7 rounded object-cover shrink-0" unoptimized />
          ) : (
            <span className="h-5 w-7 rounded bg-white/10 shrink-0" />
          )}
          <span className={clsx(
            'text-xs font-semibold truncate',
            isWinner ? 'text-gold' : 'text-cream/70'
          )}>
            {team.name}
          </span>
        </>
      ) : (
        <span className="text-xs text-cream/20 italic truncate">{seed ?? 'TBD'}</span>
      )}
    </div>
  )
}
