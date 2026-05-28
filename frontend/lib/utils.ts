import { MatchSummary } from './types'

export function displayScore(match: MatchSummary): { home: number | null; away: number | null; suffix: string } {
  const s = match.score
  const status = match.status

  if (status === 'scheduled') return { home: null, away: null, suffix: '' }

  if (s.pen_home !== null && s.pen_away !== null) {
    // Show ET score + PSO callout
    return { home: s.et_home, away: s.et_away, suffix: `(${s.pen_home}–${s.pen_away} pens)` }
  }
  if (s.et_home !== null && s.et_away !== null) {
    return { home: s.et_home, away: s.et_away, suffix: 'AET' }
  }
  if (s.ft_home !== null && s.ft_away !== null) {
    return { home: s.ft_home, away: s.ft_away, suffix: '' }
  }
  if (s.ht_home !== null && s.ht_away !== null) {
    return { home: s.ht_home, away: s.ht_away, suffix: 'HT' }
  }
  return { home: 0, away: 0, suffix: '' }
}

export function formatKickoff(isoString: string): string {
  const d = new Date(isoString)
  return d.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

export function formatMinute(minute: number, added: number): string {
  return added > 0 ? `${minute}+${added}'` : `${minute}'`
}

export function stageName(stage: string): string {
  return (
    {
      group:       'Group Stage',
      r32:         'Round of 32',
      r16:         'Round of 16',
      qf:          'Quarter-final',
      sf:          'Semi-final',
      third_place: 'Third Place',
      final:       'Final',
    }[stage] ?? stage
  )
}

export function positionOrder(pos: string | null): number {
  return ({ GK: 0, DEF: 1, MID: 2, FWD: 3 }[pos ?? ''] ?? 4)
}

export const EVENT_ICON: Record<string, string> = {
  goal:               '⚽',
  own_goal:           '⚽',
  goal_penalty_miss:  '✕',
  assist:             '🎯',
  yellow_card:        '🟨',
  yellow_red_card:    '🟨🟥',
  red_card:           '🟥',
  substitution_off:   '↓',
  substitution_on:    '↑',
}
