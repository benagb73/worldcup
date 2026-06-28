'use client'

import { useBracket } from '@/lib/hooks'
import { BracketSlot, Team } from '@/lib/types'
import { displayScore, stageName } from '@/lib/utils'
import Image from 'next/image'
import Link from 'next/link'
import clsx from 'clsx'

const STAGE_ORDER = ['r32', 'r16', 'qf', 'sf', 'third_place', 'final']

export default function BracketPage() {
  const { data: slots, isLoading } = useBracket()

  if (isLoading) return <Skeleton />

  const byStage: Record<string, BracketSlot[]> = {}
  for (const s of (slots ?? [])) {
    byStage[s.stage] = [...(byStage[s.stage] ?? []), s]
  }

  const stagesPresent = STAGE_ORDER.filter(s => byStage[s]?.length)

  return (
    <div className="space-y-12">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-3xl border border-white/10 panel">
        <div className="absolute inset-0 opacity-50">
          <div className="absolute -top-32 left-1/2 -translate-x-1/2 h-72 w-[60%] rounded-full bg-amber-500/20 blur-3xl" />
        </div>
        <div className="relative px-6 py-10 sm:px-10 sm:py-12">
          <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">KNOCKOUT STAGE</div>
          <h1 className="mt-2 font-display text-5xl tracking-tight text-cream sm:text-6xl">
            ROAD TO THE <span className="text-gold-gradient">FINAL</span>
          </h1>
          <p className="mt-3 max-w-xl text-sm text-cream/50">
            Win or go home. The bracket fills in as teams advance from the group stage.
            Tap any tie to dive into the full match details.
          </p>
        </div>
      </section>

      {stagesPresent.length === 0 ? (
        <EmptyBracket />
      ) : (
        <>
          {/* DESKTOP: horizontal tournament tree. Each column uses
              flex-col + justify-around at a shared min-height so R16 cards
              auto-align with the midpoint between their two R32 feeders,
              QF with its two R16s, etc. Third-place sits below, separately. */}
          <div className="hidden lg:block">
            <TournamentTree byStage={byStage} stagesPresent={stagesPresent} />
          </div>

          {/* MOBILE: stack stages vertically with the original card grid. */}
          <div className="lg:hidden space-y-12">
            {stagesPresent.map(stage => (
              <section key={stage}>
                <div className="mb-5 flex items-end justify-between">
                  <div>
                    <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">STAGE</div>
                    <h2 className="font-display text-3xl tracking-wide text-cream">
                      {stageName(stage).toUpperCase()}
                    </h2>
                  </div>
                  <span className="hidden sm:block text-[10px] font-bold tracking-widest text-cream/40">
                    {byStage[stage].length} {byStage[stage].length === 1 ? 'MATCH' : 'MATCHES'}
                  </span>
                </div>

                <div className={clsx(
                  'grid gap-4',
                  stage === 'final' || stage === 'third_place' ? 'max-w-2xl mx-auto' :
                  stage === 'sf' || stage === 'qf' ? 'sm:grid-cols-2' :
                  'sm:grid-cols-2'
                )}>
                  {byStage[stage].map(slot => (
                    <BracketCard key={slot.slot} slot={slot} stage={stage} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Desktop tournament tree
// ---------------------------------------------------------------------------

const MAIN_TREE_STAGES = ['r32', 'r16', 'qf', 'sf', 'final'] as const
// R32 baseline: 16 cards × ~110px each = comfortable column height. Other
// columns share this so flexbox justify-around aligns each card with its
// feeder midpoint automatically.
const TREE_MIN_HEIGHT_PX = 1760

function TournamentTree({ byStage, stagesPresent }: {
  byStage: Record<string, BracketSlot[]>
  stagesPresent: string[]
}) {
  const mainStages = MAIN_TREE_STAGES.filter(s => stagesPresent.includes(s))
  // Sort each column by slot so feeders line up with downstream matches
  const columns = mainStages.map(s => ({
    stage: s,
    slots: [...(byStage[s] ?? [])].sort((a, b) => a.slot - b.slot),
  }))

  const third = byStage['third_place'] ?? []

  return (
    <>
      <div
        className="flex items-stretch gap-3"
        style={{ minHeight: TREE_MIN_HEIGHT_PX }}
      >
        {columns.map((col, ci) => (
          <div key={col.stage} className="flex-1 min-w-0 flex flex-col">
            <div className="mb-3 text-center">
              <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">
                STAGE
              </div>
              <h2 className="font-display text-lg tracking-wide text-cream">
                {stageName(col.stage).toUpperCase()}
              </h2>
            </div>
            {/* The actual tournament-tree alignment trick. flex-1 +
                justify-around means each column's cards distribute evenly
                over the same vertical span — so 16 → 8 → 4 → 2 → 1 cards
                naturally line up at the right midpoints. */}
            <div className="flex-1 flex flex-col justify-around gap-3">
              {col.slots.map(slot => (
                <BracketCard key={slot.slot} slot={slot} stage={col.stage} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Third-place playoff lives off to the side — not part of the main bracket. */}
      {third.length > 0 && (
        <div className="mt-10 max-w-md mx-auto">
          <div className="mb-3 text-center">
            <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">CONSOLATION</div>
            <h2 className="font-display text-2xl tracking-wide text-cream">
              {stageName('third_place').toUpperCase()}
            </h2>
          </div>
          {third.map(slot => (
            <BracketCard key={slot.slot} slot={slot} stage="third_place" />
          ))}
        </div>
      )}
    </>
  )
}

function BracketCard({ slot, stage }: { slot: BracketSlot; stage: string }) {
  const hasMatch = !!slot.match
  const m = slot.match
  const { home, away, suffix } = m ? displayScore(m) : { home: null, away: null, suffix: '' }
  const isLive = m?.status.startsWith('live')
  const isFinal = m?.status === 'final'

  const inner = (
    <div className={clsx(
      'relative overflow-hidden rounded-2xl border p-4 transition-all hover-lift',
      isLive
        ? 'border-live/40 bg-gradient-to-br from-live/10 to-navy-800/40 shadow-[0_8px_32px_-12px_rgba(239,68,68,0.35)]'
        : hasMatch
        ? 'border-white/10 panel hover:border-amber-400/30'
        : 'border-dashed border-white/10 bg-white/[0.02]'
    )}>
      {/* Top label */}
      <div className="mb-3 flex items-center justify-between text-[10px] font-bold tracking-widest">
        {isLive ? (
          <span className="flex items-center gap-1.5 text-live">
            <span className="live-dot" />
            LIVE
          </span>
        ) : isFinal ? (
          <span className="text-cream/40">FULL TIME{suffix && !suffix.includes('pens') ? ` · ${suffix.toUpperCase()}` : ''}</span>
        ) : (
          <span className="text-cream/40">{stageName(stage).toUpperCase()}</span>
        )}
        <span className="text-cream/30">#{slot.slot}</span>
      </div>

      {/* Teams */}
      <div className="space-y-2">
        <BracketRow team={slot.home_team} provisional={slot.home_team_provisional} seed={slot.home_seed_desc} score={home} isWinner={m?.winner_id === slot.home_team?.id} isLive={isLive ?? false} />
        <BracketRow team={slot.away_team} provisional={slot.away_team_provisional} seed={slot.away_seed_desc} score={away} isWinner={m?.winner_id === slot.away_team?.id} isLive={isLive ?? false} />
      </div>

      {suffix && suffix.includes('pens') && (
        <div className="mt-3 text-center">
          <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold tracking-widest text-amber-400">
            {suffix.toUpperCase()}
          </span>
        </div>
      )}
    </div>
  )

  if (hasMatch && m) {
    return <Link href={`/match/${m.id}`} className="block">{inner}</Link>
  }
  return inner
}

function BracketRow({ team, provisional, seed, score, isWinner, isLive }: {
  team: Team | null
  provisional: Team | null
  seed: string | null
  score: number | null
  isWinner: boolean
  isLive: boolean
}) {
  // Three render modes:
  //  1. confirmed team   — bold, full-opacity name + real flag
  //  2. provisional team — italic, dimmed name + real flag, same TBD vibe
  //                        so it's obvious the team hasn't actually clinched
  //  3. nothing known    — italic seed_desc placeholder ("Winner Group F"...)
  const showTeam = team ?? provisional
  const isProvisional = !team && !!provisional

  return (
    <div className={clsx(
      'flex items-center gap-3 rounded-lg px-2.5 py-2',
      isWinner ? 'bg-amber-500/10 ring-1 ring-amber-400/30' : 'bg-white/[0.02]'
    )}>
      {showTeam ? (
        <>
          <Flag url={showTeam.flag_url} code={showTeam.code} />
          <span className={clsx(
            'flex-1 truncate text-sm',
            isProvisional ? 'italic font-semibold text-cream/35' :
            isWinner ? 'font-bold text-cream' :
            'font-bold text-cream/70'
          )}>
            {showTeam.name}
          </span>
          {isProvisional && (
            <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[8px] font-bold tracking-widest text-cream/30">
              AS&nbsp;IT&nbsp;STANDS
            </span>
          )}
        </>
      ) : (
        <>
          <span className="h-5 w-7 rounded-sm bg-white/10 ring-1 ring-black/40" />
          <span className="flex-1 truncate text-sm italic text-cream/35">{seed ?? 'TBD'}</span>
        </>
      )}
      <span className={clsx(
        'font-display text-2xl leading-none tabular-nums tracking-tight',
        score === null ? 'text-cream/15' :
        isLive ? 'text-amber-400 animate-score-in' :
        isWinner ? 'text-cream' : 'text-cream/50'
      )}>
        {score ?? '–'}
      </span>
    </div>
  )
}

function Flag({ url, code }: { url: string | null; code: string }) {
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

function EmptyBracket() {
  return (
    <div className="rounded-3xl border border-dashed border-white/10 panel px-8 py-16 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/10 text-3xl">🏆</div>
      <h2 className="mt-4 font-display text-2xl tracking-wide text-cream">Bracket Coming Soon</h2>
      <p className="mt-2 max-w-md mx-auto text-sm text-cream/50">
        The knockout bracket fills in once the group stage concludes — the top two from
        each group plus the eight best third-placed teams advance. Check back as the
        tournament progresses.
      </p>
      <Link
        href="/"
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-gold-gradient px-4 py-2 text-xs font-bold text-ink shadow-gold transition-transform hover:scale-105"
      >
        VIEW GROUP STANDINGS →
      </Link>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-10">
      <div className="h-48 rounded-3xl shimmer" />
      {[1, 2, 3].map(i => (
        <div key={i} className="space-y-4">
          <div className="h-8 w-48 rounded shimmer" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map(j => <div key={j} className="h-32 rounded-2xl shimmer" />)}
          </div>
        </div>
      ))}
    </div>
  )
}
