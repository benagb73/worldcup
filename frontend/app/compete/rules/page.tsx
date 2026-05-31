'use client'

import Link from 'next/link'
import { useScoringConfig } from '@/lib/hooks'
import { ScoringConfig } from '@/lib/types'

export default function RulesPage() {
  const { data, isLoading } = useScoringConfig()

  if (isLoading) return <Skeleton />
  const sc: ScoringConfig = data ?? {
    result_points: 2, both_scores_points: 5, one_score_points: 1,
    first_scorer_points: 3, joker_multiplier: 2, pen_winner_bonus_goal: 1,
    tournament_started: false,
  }

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <Link
        href="/compete"
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-cream/60 hover:border-amber-400/30 hover:text-gold"
      >
        ← Leaderboard
      </Link>

      <section className="relative overflow-hidden rounded-3xl border border-white/10 panel p-8 sm:p-10">
        <div className="absolute -top-32 -right-32 h-72 w-72 rounded-full bg-amber-500/20 blur-3xl" />
        <div className="relative">
          <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">HOW IT WORKS</div>
          <h1 className="mt-1 font-display text-5xl tracking-tight text-cream">
            RULES &amp; <span className="text-gold-gradient">SCORING</span>
          </h1>
        </div>
      </section>

      {/* Scoring */}
      <Section eyebrow="POINTS" title="How you score">
        <Rule
          points={sc.result_points}
          label="Correct result"
          desc="Pick the winning side (or a draw, for group games). Knockout matches that go to penalties: the shootout winner counts as the winner of the result."
        />
        <Rule
          points={sc.both_scores_points}
          label="Exact scoreline"
          desc="Both teams' goals correct. Replaces the single-team bonus — you get 5, not 5 + 1."
        />
        <Rule
          points={sc.one_score_points}
          label="One team's goals correct"
          desc="Only awarded when you don't get both. e.g. you said 2-1, actual is 2-0."
        />
        <Rule
          points={sc.first_scorer_points}
          label="First goalscorer"
          desc={`Pick the player who scores the first true goal of the match (own goals don't count). Pick "No goal scored" if you think it'll be 0-0.`}
        />
        <Rule
          points={`×${sc.joker_multiplier}`}
          label="Joker"
          desc="Doubles the total points on a single match. See joker allocation below."
          accent="multiplier"
        />
      </Section>

      {/* Knockout penalty rule */}
      <Section eyebrow="KNOCKOUTS" title="Penalty shootouts">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-cream/70">
          For knockout matches decided on penalties, the shootout winner is treated as if they scored
          <span className="mx-1 font-bold text-amber-400">+{sc.pen_winner_bonus_goal} extra goal</span>
          beyond the in-play scoreline. So if Brazil &amp; France tie 1–1 and Brazil wins on pens,
          the &ldquo;effective&rdquo; score for scoring purposes is <span className="font-mono text-cream">Brazil 2-1 France</span>.
          That way picking the right winner gets you the result points (and a chance at exact-score points)
          even when the regulation scoreline was a tie.
        </div>
      </Section>

      {/* Jokers */}
      <Section eyebrow="JOKERS" title="How many you get">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] divide-y divide-white/5">
          <JokerLine round="Group stage · Matchday 1 (24 games)" count={2} />
          <JokerLine round="Group stage · Matchday 2 (24 games)" count={2} />
          <JokerLine round="Group stage · Matchday 3 (24 games)" count={2} />
          <JokerLine round="Round of 32 (16 games)"              count={1} />
          <JokerLine round="Round of 16 (8 games)"               count={1} />
          <JokerLine round="Quarter-finals (4 games)"            count={1} />
          <JokerLine round="Semi-finals (2 games)"               count={1} />
          <JokerLine round="Final (1 game)"                      count={1} />
          <JokerLine round="Third-place playoff"                 count={0} hint="No joker" />
        </div>
        <p className="mt-3 text-xs text-cream/40">
          <span className="font-bold text-cream/70">11 jokers total</span> per competitor across the tournament.
          You can change which match you play a joker on right up until kickoff.
        </p>
      </Section>

      {/* Picks */}
      <Section eyebrow="MAKING PICKS" title="Deadlines">
        <ul className="space-y-2 text-sm text-cream/70">
          <li>· Picks lock <span className="font-bold text-cream">at kickoff</span> — you can edit them right up until the match starts.</li>
          <li>· You don&rsquo;t have to pick every match — but a missing pick is zero points.</li>
          <li>· Anyone with your picks-page URL can edit your picks. Keep it private.</li>
        </ul>
      </Section>
    </div>
  )
}

function Section({ eyebrow, title, children }: {
  eyebrow: string; title: string; children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-4">
        <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">{eyebrow}</div>
        <h2 className="font-display text-2xl tracking-wide text-cream sm:text-3xl">{title}</h2>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Rule({ points, label, desc, accent }: {
  points: number | string; label: string; desc: string; accent?: 'multiplier'
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex items-start gap-4">
      <div className={`shrink-0 flex h-14 w-14 items-center justify-center rounded-xl border ${
        accent === 'multiplier'
          ? 'border-amber-400/40 bg-amber-500/10 text-amber-400'
          : 'border-amber-400/30 bg-amber-500/5 text-gold-gradient'
      } font-display text-2xl tabular-nums`}>
        {typeof points === 'number' ? `+${points}` : points}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-bold text-cream">{label}</div>
        <div className="mt-1 text-xs text-cream/60">{desc}</div>
      </div>
    </div>
  )
}

function JokerLine({ round, count, hint }: { round: string; count: number; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <span className="text-sm text-cream/80">{round}</span>
      <span className={`font-display text-sm tracking-wider ${
        count === 0 ? 'text-cream/30' : 'text-amber-400'
      }`}>
        {hint ?? (count + (count === 1 ? ' joker' : ' jokers'))}
      </span>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="space-y-6">
      <div className="h-7 w-32 rounded-full shimmer" />
      <div className="h-40 rounded-3xl shimmer" />
      <div className="h-72 rounded-2xl shimmer" />
    </div>
  )
}
