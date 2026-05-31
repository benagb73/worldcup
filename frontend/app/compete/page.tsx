'use client'

import Link from 'next/link'
import clsx from 'clsx'
import { useCompetitors, useScoringConfig } from '@/lib/hooks'
import { CompetitorRow, ScoringConfig } from '@/lib/types'

export default function CompeteIndexPage() {
  const { data: competitors, isLoading } = useCompetitors()
  const { data: scoring }                = useScoringConfig()

  if (isLoading) return <Skeleton />

  const rows: CompetitorRow[] = competitors ?? []
  const sc: ScoringConfig | undefined = scoring

  return (
    <div className="space-y-10">
      <Hero scoring={sc} />

      {rows.length === 0 ? (
        <section className="rounded-3xl border border-dashed border-white/10 panel p-10 text-center">
          <div className="text-3xl mb-3">🏆</div>
          <h2 className="font-display text-2xl tracking-wide text-cream">No one&rsquo;s playing yet</h2>
          <p className="mt-2 text-sm text-cream/50">Be the first to join the family pool.</p>
          <Link
            href="/compete/join"
            className="mt-6 inline-block rounded-xl bg-gold-gradient px-5 py-2.5 font-display tracking-wider text-ink shadow-gold transition-transform hover:scale-105"
          >
            JOIN NOW →
          </Link>
        </section>
      ) : (
        <section>
          <div className="mb-5 flex items-end justify-between">
            <SectionHeading eyebrow="STANDINGS" title="Family Leaderboard" />
            <Link
              href="/compete/join"
              className="rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-[11px] font-bold tracking-widest text-amber-400 hover:bg-amber-500/20"
            >
              + JOIN
            </Link>
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/10 panel">
            <div className="hidden sm:grid grid-cols-[60px_1fr_1fr_repeat(3,minmax(0,80px))] items-center gap-2 border-b border-white/5 bg-black/30 px-4 py-2.5 text-[10px] font-bold tracking-widest text-cream/40">
              <span className="text-center">RANK</span>
              <span>TEAM</span>
              <span>MANAGER</span>
              <span className="text-center">PICKS</span>
              <span className="text-center">JOKERS</span>
              <span className="text-center text-gold">POINTS</span>
            </div>
            <div className="divide-y divide-white/5">
              {rows.map((c, i) => <CompetitorRowItem key={c.id} comp={c} rank={i + 1} />)}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function Hero({ scoring }: { scoring?: ScoringConfig }) {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-white/10 panel">
      <div className="absolute inset-0 opacity-60">
        <div className="absolute -top-32 left-1/4 h-72 w-72 rounded-full bg-amber-500/20 blur-3xl" />
      </div>
      <div className="relative px-6 py-10 sm:px-10 sm:py-12">
        <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">FAMILY COMP</div>
        <h1 className="mt-1 font-display text-5xl tracking-tight text-cream sm:text-6xl">
          PICK&rsquo;EM <span className="text-gold-gradient">POOL</span>
        </h1>
        <p className="mt-3 max-w-xl text-sm text-cream/50">
          Guess every match, play your jokers wisely. Points awarded for correct results, scorelines and first scorers.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/compete/join"
            className="rounded-full bg-gold-gradient px-4 py-2 text-xs font-bold tracking-widest text-ink shadow-gold transition-transform hover:scale-105"
          >
            JOIN →
          </Link>
          <Link
            href="/compete/rules"
            className="rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-bold tracking-widest text-cream/60 hover:text-cream hover:border-white/20"
          >
            RULES & SCORING
          </Link>
        </div>
        {scoring && (
          <div className="mt-4 text-[10px] tracking-widest text-cream/30">
            +{scoring.result_points} RESULT · +{scoring.both_scores_points} EXACT SCORE ·
            +{scoring.one_score_points} ONE TEAM · +{scoring.first_scorer_points} 1ST SCORER ·
            JOKER ×{scoring.joker_multiplier}
          </div>
        )}
      </div>
    </section>
  )
}

function CompetitorRowItem({ comp, rank }: { comp: CompetitorRow; rank: number }) {
  const isTop3 = rank <= 3
  return (
    <Link
      href={`/compete/${comp.id}`}
      className="group grid grid-cols-[60px_1fr_auto] items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.04] sm:grid-cols-[60px_1fr_1fr_repeat(3,minmax(0,80px))]"
    >
      <div className="text-center">
        <span className={clsx(
          'inline-flex h-7 w-7 items-center justify-center rounded-full font-display text-sm',
          rank === 1 ? 'bg-gold-gradient text-ink shadow-gold' :
          rank === 2 ? 'bg-cream/20 text-cream' :
          rank === 3 ? 'bg-amber-600/30 text-amber-400' :
          'text-cream/40'
        )}>{rank}</span>
      </div>

      <div className="min-w-0">
        <div className={clsx(
          'truncate font-display text-base tracking-wider',
          isTop3 ? 'text-cream' : 'text-cream/85'
        )}>
          {comp.team_name.toUpperCase()}
        </div>
        <div className="sm:hidden truncate text-[11px] text-cream/40">
          {comp.name} · {comp.picks_made} picks · {comp.jokers_played} jokers · <span className="font-bold text-gold">{comp.total_points} pts</span>
        </div>
      </div>

      <div className="hidden truncate text-sm text-cream/60 sm:block">{comp.name}</div>
      <div className="hidden text-center font-mono text-xs text-cream/60 sm:block">{comp.picks_made}</div>
      <div className="hidden text-center font-mono text-xs text-cream/60 sm:block">{comp.jokers_played}</div>
      <div className="hidden text-center font-display text-2xl tabular-nums sm:block">
        <span className={clsx(isTop3 ? 'text-gold-gradient' : 'text-cream')}>
          {comp.total_points}
        </span>
      </div>

      <span className="text-cream/30 sm:hidden">→</span>
    </Link>
  )
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div>
      <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">{eyebrow}</div>
      <h2 className="font-display text-2xl tracking-wide text-cream sm:text-3xl">{title}</h2>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-8">
      <div className="h-56 rounded-3xl shimmer" />
      <div className="h-96 rounded-2xl shimmer" />
    </div>
  )
}
