'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import clsx from 'clsx'
import {
  adminFetch, getSecret, AdminAuthError,
  AdminMatchRow, AdminEvent, RosterPlayer, AdminTeam, AdminStatRow,
} from '@/lib/admin'
import { stageName, formatMinute } from '@/lib/utils'

const STATUS_OPTIONS = [
  { value: 'scheduled',        label: 'Scheduled' },
  { value: 'live',             label: 'Live (90)' },
  { value: 'live_et',          label: 'Live (extra time)' },
  { value: 'live_penalties',   label: 'Live (penalties)' },
  { value: 'final',            label: 'Final' },
  { value: 'postponed',        label: 'Postponed' },
]

// NOTE: own goals are entered as event_type='goal' + "Own goal" checkbox.
// There is intentionally NO separate 'own_goal' option here so the admin
// can't double-enter the same goal via two paths.
const EVENT_TYPES = [
  { value: 'goal',              label: '⚽ Goal' },
  { value: 'goal_penalty_miss', label: '✕ Penalty miss' },
  { value: 'assist',            label: '🎯 Assist' },
  { value: 'yellow_card',       label: '🟨 Yellow card' },
  { value: 'yellow_red_card',   label: '🟨🟥 2nd yellow' },
  { value: 'red_card',          label: '🟥 Red card' },
  { value: 'substitution_off',  label: '⇆ Substitution' },
]

const PERIOD_OPTIONS = [
  { value: 'normal',       label: 'Normal time' },
  { value: 'extra_time_1', label: 'Extra time 1' },
  { value: 'extra_time_2', label: 'Extra time 2' },
  { value: 'penalties',    label: 'Penalty shootout' },
]

export default function AdminMatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const matchId = Number(id)

  const [ready, setReady] = useState(false)
  const [authError, setAuthError] = useState(false)

  useEffect(() => {
    if (!getSecret()) { setAuthError(true); return }
    setReady(true)
  }, [])

  if (authError) {
    return (
      <div className="text-center py-20">
        <p className="text-cream/60">No admin session.</p>
        <Link href="/admin" className="mt-2 inline-block text-amber-400 hover:underline">→ Sign in</Link>
      </div>
    )
  }
  if (!ready) return null

  return <Editor matchId={matchId} />
}

// ---------------------------------------------------------------------------
// Editor
// ---------------------------------------------------------------------------

function Editor({ matchId }: { matchId: number }) {
  const [match, setMatch] = useState<AdminMatchRow | null>(null)
  const [events, setEvents] = useState<AdminEvent[]>([])
  const [homeRoster, setHomeRoster] = useState<RosterPlayer[]>([])
  const [awayRoster, setAwayRoster] = useState<RosterPlayer[]>([])
  const [error, setError] = useState<string | null>(null)
  const [savingMatch, setSavingMatch] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const all = await adminFetch<AdminMatchRow[]>('/matches')
      const m = all.find(x => x.id === matchId)
      if (!m) { setError('Match not found'); return }
      setMatch(m)

      // Only fetch rosters for teams that are actually set
      const [evs, hr, ar] = await Promise.all([
        adminFetch<AdminEvent[]>(`/matches/${matchId}/events`),
        m.home_id ? adminFetch<RosterPlayer[]>(`/teams/${m.home_id}/players`) : Promise.resolve([]),
        m.away_id ? adminFetch<RosterPlayer[]>(`/teams/${m.away_id}/players`) : Promise.resolve([]),
      ])
      setEvents(evs)
      setHomeRoster(hr)
      setAwayRoster(ar)
    } catch (e) {
      if (e instanceof AdminAuthError) { window.location.href = '/admin'; return }
      setError(String(e))
    }
  }, [matchId])

  useEffect(() => { refresh() }, [refresh])

  async function saveMatch(patch: Partial<AdminMatchRow>) {
    if (!match) return
    setSavingMatch(true)
    try {
      await adminFetch(`/matches/${matchId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      setFlash('Saved ✓')
      setTimeout(() => setFlash(null), 1500)
      await refresh()
    } catch (e) {
      setError(String(e))
    } finally {
      setSavingMatch(false)
    }
  }

  if (error)   return <div className="py-20 text-center text-live">{error}</div>
  if (!match) return <div className="py-20"><div className="h-40 shimmer rounded-2xl" /></div>

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between gap-4">
        <Link
          href="/admin"
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-cream/60 hover:border-amber-400/30 hover:text-gold"
        >
          ← Match list
        </Link>
        <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">
          {stageName(match.stage).toUpperCase()}{match.group_name ? ` · GROUP ${match.group_name}` : ''}
        </div>
      </div>

      {/* Header: teams + status */}
      <div className="rounded-2xl border border-white/10 panel p-6 sm:p-8">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <div className="text-right">
            <div className={clsx(
              'font-display text-xl sm:text-3xl tracking-wider',
              match.home_name ? 'text-cream' : 'italic text-cream/40'
            )}>{match.home_name?.toUpperCase() ?? 'TBD'}</div>
            <div className="mt-1 font-mono text-[10px] tracking-widest text-cream/40">{match.home_code ?? '—'}</div>
          </div>
          <div className="text-center text-cream/30 font-display text-3xl tracking-widest">VS</div>
          <div className="text-left">
            <div className={clsx(
              'font-display text-xl sm:text-3xl tracking-wider',
              match.away_name ? 'text-cream' : 'italic text-cream/40'
            )}>{match.away_name?.toUpperCase() ?? 'TBD'}</div>
            <div className="mt-1 font-mono text-[10px] tracking-widest text-cream/40">{match.away_code ?? '—'}</div>
          </div>
        </div>
      </div>

      {/* Knockout matches: always show the team picker so admin can
          set/override home and away as winners are decided. Group-stage
          matches don't need this — their teams are seeded up front. */}
      {match.stage !== 'group' && (
        <TeamPickerPanel match={match} onSaved={refresh} />
      )}

      {flash && (
        <div className="fixed bottom-6 right-6 rounded-full bg-amber-500/20 px-4 py-2 text-sm font-bold text-amber-400 shadow-gold backdrop-blur z-50">
          {flash}
        </div>
      )}

      {/* Score + status panel */}
      <ScorePanel match={match} onSave={saveMatch} busy={savingMatch} />

      {/* Events log + Lineups + Stats — only meaningful once teams are set */}
      {match.home_id != null && match.away_id != null && (
        <>
          <EventsPanel
            match={match}
            events={events}
            homeRoster={homeRoster}
            awayRoster={awayRoster}
            onChange={refresh}
          />
          <LineupPanel
            match={match}
            homeRoster={homeRoster}
            awayRoster={awayRoster}
          />
          <StatsPanel match={match} />
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Score panel
// ---------------------------------------------------------------------------

function ScorePanel({ match, onSave, busy }: {
  match: AdminMatchRow
  onSave: (patch: Partial<AdminMatchRow>) => void
  busy: boolean
}) {
  const [status, setStatus] = useState(match.status)
  const [scores, setScores] = useState({
    ht_home: match.ht_home, ht_away: match.ht_away,
    ft_home: match.ft_home, ft_away: match.ft_away,
    et_home: match.et_home, et_away: match.et_away,
    pen_home: match.pen_home, pen_away: match.pen_away,
  })
  const [attendance, setAttendance] = useState<number | null>(match.attendance)

  useEffect(() => {
    setStatus(match.status)
    setScores({
      ht_home: match.ht_home, ht_away: match.ht_away,
      ft_home: match.ft_home, ft_away: match.ft_away,
      et_home: match.et_home, et_away: match.et_away,
      pen_home: match.pen_home, pen_away: match.pen_away,
    })
    setAttendance(match.attendance)
  }, [match])

  const set = (k: keyof typeof scores, v: number | null) =>
    setScores(prev => ({ ...prev, [k]: v }))

  // Quick-tap buttons: increment a score column without a save
  function bump(col: keyof typeof scores, delta: number) {
    const cur = scores[col] ?? 0
    set(col, Math.max(0, cur + delta))
  }

  function save() {
    // Backend treats attendance=0 as "clear back to NULL"; we send 0 when the
    // input is blank so the admin can wipe a wrong value.
    onSave({ status, ...scores, attendance: attendance ?? 0 } as any)
  }

  const fillPct = (attendance != null && match.venue_capacity)
    ? Math.round((attendance / match.venue_capacity) * 100)
    : null

  return (
    <section className="rounded-2xl border border-white/10 panel p-6">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">SCORE & STATUS</div>
          <h2 className="font-display text-2xl tracking-wide text-cream">Live Scoreline</h2>
        </div>
        <button
          onClick={save}
          disabled={busy}
          className="rounded-xl bg-gold-gradient px-5 py-2.5 font-display tracking-wider text-ink shadow-gold transition-transform hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
        >
          {busy ? 'SAVING…' : 'SAVE'}
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        {/* Score grid */}
        <div className="space-y-4">
          <ScoreRow label="Half time" homeKey="ht_home" awayKey="ht_away" scores={scores} set={set} bump={bump} />
          <ScoreRow label="Full time" homeKey="ft_home" awayKey="ft_away" scores={scores} set={set} bump={bump} accent />
          <ScoreRow label="After extra time" homeKey="et_home" awayKey="et_away" scores={scores} set={set} bump={bump} />
          <ScoreRow label="Penalty shootout" homeKey="pen_home" awayKey="pen_away" scores={scores} set={set} bump={bump} />
        </div>

        {/* Status selector + attendance */}
        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-bold tracking-widest text-cream/40">STATUS</label>
            <div className="mt-2 space-y-2">
              {STATUS_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setStatus(opt.value)}
                  className={clsx(
                    'w-full rounded-lg border px-3 py-2 text-left text-sm font-semibold transition-colors',
                    status === opt.value
                      ? 'border-amber-400/50 bg-amber-500/10 text-amber-400'
                      : 'border-white/10 bg-white/[0.02] text-cream/60 hover:border-white/20 hover:text-cream'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
            <label className="text-[10px] font-bold tracking-widest text-cream/40 block">
              ATTENDANCE
              {match.venue_capacity != null && (
                <span className="ml-2 font-normal text-cream/30 normal-case tracking-normal">
                  capacity {match.venue_capacity.toLocaleString()}
                </span>
              )}
            </label>
            <input
              type="number"
              min={0}
              value={attendance ?? ''}
              onChange={e => setAttendance(e.target.value === '' ? null : Math.max(0, Number(e.target.value)))}
              onFocus={e => e.target.select()}
              placeholder="not yet known"
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-right font-mono text-base tabular-nums text-cream placeholder:text-cream/30 focus:border-amber-400/50 focus:outline-none"
            />
            {fillPct != null && (
              <div className="mt-1.5 text-right text-[10px] font-bold tracking-widest text-amber-400">
                {fillPct}% FULL
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

function ScoreRow({ label, homeKey, awayKey, scores, set, bump, accent }: {
  label: string
  homeKey: keyof typeof scoreKeys
  awayKey: keyof typeof scoreKeys
  scores: Record<string, number | null>
  set: (k: any, v: number | null) => void
  bump: (k: any, delta: number) => void
  accent?: boolean
}) {
  return (
    <div className={clsx(
      'rounded-xl border p-3',
      accent ? 'border-amber-400/30 bg-amber-500/[0.04]' : 'border-white/10 bg-white/[0.02]'
    )}>
      <div className="mb-2 text-[10px] font-bold tracking-widest text-cream/40">{label.toUpperCase()}</div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <ScoreCell value={scores[homeKey]} onChange={v => set(homeKey, v)} onBump={d => bump(homeKey, d)} />
        <span className="font-display text-2xl text-cream/30">:</span>
        <ScoreCell value={scores[awayKey]} onChange={v => set(awayKey, v)} onBump={d => bump(awayKey, d)} />
      </div>
    </div>
  )
}

// Dummy export so the type lookup works
const scoreKeys = {
  ht_home: 0, ht_away: 0, ft_home: 0, ft_away: 0,
  et_home: 0, et_away: 0, pen_home: 0, pen_away: 0,
}

function ScoreCell({ value, onChange, onBump }: {
  value: number | null
  onChange: (v: number | null) => void
  onBump: (delta: number) => void
}) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      <button
        type="button"
        onClick={() => onBump(-1)}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-cream/60 hover:border-live/40 hover:text-live"
      >−</button>
      <input
        type="number"
        min={0}
        value={value ?? ''}
        onChange={e => {
          const v = e.target.value === '' ? null : Math.max(0, Number(e.target.value))
          onChange(v)
        }}
        onFocus={e => e.target.select()}
        placeholder="–"
        className="w-14 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-center font-display text-2xl tabular-nums text-cream placeholder:text-cream/20 focus:border-amber-400/50 focus:outline-none"
      />
      <button
        type="button"
        onClick={() => onBump(+1)}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-cream/60 hover:border-amber-400/50 hover:text-amber-400"
      >+</button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Events panel
// ---------------------------------------------------------------------------

function EventsPanel({ match, events, homeRoster, awayRoster, onChange }: {
  match: AdminMatchRow
  events: AdminEvent[]
  homeRoster: RosterPlayer[]
  awayRoster: RosterPlayer[]
  onChange: () => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)

  async function deleteEvent(id: number) {
    if (!confirm('Delete this event?')) return
    setBusy(true)
    try {
      await adminFetch(`/events/${id}`, { method: 'DELETE' })
      await onChange()
    } finally { setBusy(false) }
  }

  return (
    <section className="rounded-2xl border border-white/10 panel p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">MATCH EVENTS</div>
          <h2 className="font-display text-2xl tracking-wide text-cream">Goals, Cards & Subs</h2>
        </div>
        <button
          onClick={() => setAdding(s => !s)}
          className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-1.5 text-xs font-bold tracking-widest text-amber-400 hover:bg-amber-500/20"
        >
          {adding ? '× CANCEL' : '+ ADD EVENT'}
        </button>
      </div>

      {adding && (
        <EventForm
          match={match}
          homeRoster={homeRoster}
          awayRoster={awayRoster}
          onSaved={async () => { setAdding(false); await onChange() }}
        />
      )}

      {events.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 py-8 text-center text-sm text-cream/40">
          No events yet. {adding ? '' : 'Click + ADD EVENT to record the first goal/card/sub.'}
        </div>
      ) : (
        <div className="mt-4 overflow-clip rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-black/80 backdrop-blur sticky top-0 z-20">
              <tr className="text-[10px] font-bold tracking-widest text-cream/40">
                <th className="px-3 py-2 text-left">MIN</th>
                <th className="px-3 py-2 text-left">TEAM</th>
                <th className="px-3 py-2 text-left">TYPE</th>
                <th className="px-3 py-2 text-left">PLAYER</th>
                <th className="px-3 py-2 text-left">PERIOD</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {events.map(e => (
                <tr key={e.id} className="hover:bg-white/[0.03]">
                  <td className="px-3 py-2 font-mono text-xs text-cream/70">
                    {formatMinute(e.minute, e.added_time)}
                  </td>
                  <td className="px-3 py-2 text-xs font-bold text-cream/70">
                    {e.team_code}
                  </td>
                  <td className="px-3 py-2 text-xs text-cream">
                    {EVENT_TYPES.find(t => t.value === e.event_type)?.label ?? e.event_type}
                    {e.is_penalty ? <span className="ml-1 text-amber-400">(P)</span> : null}
                    {e.is_own_goal ? <span className="ml-1 text-cream/40">(OG)</span> : null}
                  </td>
                  <td className="px-3 py-2 text-xs text-cream">{e.player_name}</td>
                  <td className="px-3 py-2 text-xs text-cream/50">{e.period.replace('_', ' ')}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => deleteEvent(e.id)}
                      disabled={busy}
                      className="text-xs text-cream/30 hover:text-live"
                    >Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function EventForm({ match, homeRoster, awayRoster, onSaved }: {
  match: AdminMatchRow
  homeRoster: RosterPlayer[]
  awayRoster: RosterPlayer[]
  onSaved: () => Promise<void>
}) {
  const initialTeam = (match.home_id ?? match.away_id) as number
  const [teamId, setTeamId]       = useState<number>(initialTeam)
  const [playerId, setPlayerId]   = useState<number | ''>('')
  const [assistId, setAssistId]   = useState<number | ''>('')
  const [subOnId, setSubOnId]     = useState<number | ''>('')
  const [type, setType]           = useState('goal')
  const [minute, setMinute]       = useState(1)
  const [added, setAdded]         = useState(0)
  const [period, setPeriod]       = useState('normal')
  const [penalty, setPenalty]     = useState(false)
  const [own, setOwn]             = useState(false)
  const [busy, setBusy]           = useState(false)
  const [err, setErr]             = useState<string | null>(null)

  // For an own goal, the unfortunate scorer is on the OPPOSING team, so the
  // player picker has to show that team's roster. Everywhere else, the player
  // belongs to the team selected above.
  const opposingTeamId = teamId === match.home_id ? match.away_id : match.home_id
  const playerTeamId   = (type === 'goal' && own) ? opposingTeamId : teamId
  const roster         = playerTeamId === match.home_id ? homeRoster : awayRoster

  // Clear the selected player whenever the relevant roster swaps (toggling
  // own-goal, changing team, etc.) — the old id won't exist in the new list.
  useEffect(() => {
    setPlayerId('')
    setAssistId('')
  }, [playerTeamId])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!playerId) { setErr('Pick a player'); return }
    if (type === 'substitution_off' && !subOnId) {
      setErr('Pick the player coming on'); return
    }
    setBusy(true)
    setErr(null)
    try {
      // Shootout kicks: minute/added are meaningless (order is by insertion
      // id within period='penalties'), and every kick IS a penalty so
      // is_penalty is true regardless of whatever the UI state says.
      const isShootout = period === 'penalties'
      await adminFetch(`/matches/${match.id}/events`, {
        method: 'POST',
        body: JSON.stringify({
          // team_id always tracks the PLAYER'S team. For an own goal that's
          // the defending team; _recompute_score_from_events credits the
          // opposing (attacking) team automatically.
          team_id: playerTeamId,
          player_id: Number(playerId),
          event_type: type,
          minute: isShootout ? 0 : minute,
          added_time: isShootout ? 0 : added,
          period,
          is_penalty: isShootout ? true : penalty,
          is_own_goal: own,
          // Only send assist_player_id for real goals (not own goals / pens-missed)
          assist_player_id:
            (type === 'goal' && !own && assistId !== '') ? Number(assistId) : null,
          sub_on_player_id:
            (type === 'substitution_off' && subOnId !== '') ? Number(subOnId) : null,
        }),
      })
      // Reset auxiliary fields for the next event entry
      setAssistId('')
      setSubOnId('')
      await onSaved()
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  const isGoalish = type === 'goal' || type === 'goal_penalty_miss'
  // Assist picker only appears for real goals (not own goals, not penalty misses)
  const canAssist = type === 'goal' && !own
  // Filter out the scorer from the assist dropdown
  const assistOptions = roster.filter(p => p.id !== playerId)

  return (
    <form onSubmit={submit} className="mb-4 rounded-xl border border-amber-400/20 bg-amber-500/[0.04] p-4">
      <div className="grid gap-3 sm:grid-cols-[140px_140px_1fr_140px]">
        <Field label={type === 'goal' && own ? 'Goal credited to' : 'Team'}>
          <select
            value={teamId}
            onChange={e => { setTeamId(Number(e.target.value)) }}
            className="adm-input"
          >
            <option value={match.home_id}>{match.home_code} {match.home_name}</option>
            <option value={match.away_id}>{match.away_code} {match.away_name}</option>
          </select>
        </Field>
        <Field label="Type">
          <select value={type} onChange={e => setType(e.target.value)} className="adm-input">
            {EVENT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </Field>
        <Field label={type === 'goal' && own ? 'Scored by (own goal — defending player)' : 'Player'}>
          <select value={playerId} onChange={e => setPlayerId(e.target.value ? Number(e.target.value) : '')} className="adm-input">
            <option value="">— select —</option>
            {roster.map(p => (
              <option key={p.id} value={p.id}>
                {p.shirt_number ? `#${p.shirt_number} ` : ''}{p.name}{p.position ? ` (${p.position})` : ''}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Period">
          <select value={period} onChange={e => setPeriod(e.target.value)} className="adm-input">
            {PERIOD_OPTIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </Field>

        {/* Shootout kicks don't need a minute — order is preserved by
            insertion (id ASC within period='penalties'). Hide the minute
            inputs to avoid clutter and accidental wrong entries. */}
        {period !== 'penalties' && (
          <>
            <Field label="Minute">
              <input type="number" min={0} max={130} value={minute}
                     onChange={e => setMinute(Number(e.target.value))}
                     onFocus={e => e.target.select()}
                     className="adm-input" />
            </Field>
            <Field label="+ Added">
              <input type="number" min={0} max={20} value={added}
                     onChange={e => setAdded(Number(e.target.value))}
                     onFocus={e => e.target.select()}
                     className="adm-input" />
            </Field>
          </>
        )}
        {period === 'penalties' && (
          <div className="self-end col-span-2 sm:col-span-1 rounded-lg border border-amber-400/20 bg-amber-500/[0.04] px-3 py-2 text-[11px] text-amber-300/80">
            Shootout kick — order is taken from entry order, no minute needed.
          </div>
        )}
        {isGoalish && (
          <div className="flex items-center gap-4 self-end">
            {/* The "Penalty" checkbox is meaningless in a shootout (every kick
                is a penalty); auto-check it and don't show the toggle. */}
            {period !== 'penalties' && (
              <label className="flex items-center gap-2 text-xs text-cream/70">
                <input type="checkbox" checked={penalty} onChange={e => setPenalty(e.target.checked)} className="accent-amber-400" />
                Penalty
              </label>
            )}
            <label className="flex items-center gap-2 text-xs text-cream/70">
              <input type="checkbox" checked={own} onChange={e => setOwn(e.target.checked)} className="accent-amber-400" />
              Own goal
            </label>
          </div>
        )}
      </div>

      {/* Assist row — only when recording a real goal */}
      {canAssist && (
        <div className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-500/[0.04] p-3">
          <Field label="Assist by (optional)">
            <select
              value={assistId}
              onChange={e => setAssistId(e.target.value ? Number(e.target.value) : '')}
              className="adm-input"
            >
              <option value="">— no assist —</option>
              {assistOptions.map(p => (
                <option key={p.id} value={p.id}>
                  {p.shirt_number ? `#${p.shirt_number} ` : ''}{p.name}{p.position ? ` (${p.position})` : ''}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {/* Sub-on row — when recording a substitution, pair player off with player on */}
      {type === 'substitution_off' && (
        <div className="mt-3 rounded-lg border border-emerald-400/20 bg-emerald-500/[0.04] p-3">
          <Field label="Coming on (required)">
            <select
              value={subOnId}
              onChange={e => setSubOnId(e.target.value ? Number(e.target.value) : '')}
              className="adm-input"
            >
              <option value="">— select —</option>
              {roster.filter(p => p.id !== playerId).map(p => (
                <option key={p.id} value={p.id}>
                  {p.shirt_number ? `#${p.shirt_number} ` : ''}{p.name}{p.position ? ` (${p.position})` : ''}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      {err && <div className="mt-3 text-xs text-live">{err}</div>}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-gold-gradient px-4 py-2 text-xs font-bold tracking-widest text-ink shadow-gold disabled:opacity-50"
        >
          {busy ? 'ADDING…' : 'ADD EVENT'}
        </button>
      </div>

      {/* shared input styling */}
      <style jsx>{`
        :global(.adm-input) {
          width: 100%;
          background: rgba(0,0,0,0.3);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 8px;
          padding: 8px 10px;
          color: var(--c-cream, #f7f5ef);
          font-size: 13px;
        }
        :global(.adm-input:focus) {
          outline: none;
          border-color: rgba(251, 191, 36, 0.5);
        }
      `}</style>
    </form>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold tracking-widest text-cream/40 mb-1">{label.toUpperCase()}</span>
      {children}
    </label>
  )
}

// ---------------------------------------------------------------------------
// Lineup panel
// ---------------------------------------------------------------------------

interface LineupDraft {
  player_id: number
  is_starter: boolean
  position_played: string
  shirt_number: number | null
}

function LineupPanel({ match, homeRoster, awayRoster }: {
  match: AdminMatchRow
  homeRoster: RosterPlayer[]
  awayRoster: RosterPlayer[]
}) {
  return (
    <section className="rounded-2xl border border-white/10 panel p-6">
      <div className="mb-4">
        <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">SQUAD SELECTION</div>
        <h2 className="font-display text-2xl tracking-wide text-cream">Lineups</h2>
        <p className="mt-1 text-xs text-cream/40">
          Tick 11 starters per side. Substitutes are anyone in the roster you toggle on but leave un-starred.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <TeamLineupEditor matchId={match.id} teamId={match.home_id} teamLabel={`${match.home_code} · ${match.home_name}`} roster={homeRoster} />
        <TeamLineupEditor matchId={match.id} teamId={match.away_id} teamLabel={`${match.away_code} · ${match.away_name}`} roster={awayRoster} />
      </div>
    </section>
  )
}

function TeamLineupEditor({ matchId, teamId, teamLabel, roster }: {
  matchId: number
  teamId: number
  teamLabel: string
  roster: RosterPlayer[]
}) {
  const [draft, setDraft] = useState<Record<number, LineupDraft>>({})
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)

  // Pre-check every roster player as PRESENT (not starter) on first load so
  // admin only has to UNCHECK the ones not in the matchday squad, then click
  // ★ on the 11 starters. Massively fewer clicks than picking from scratch.
  useEffect(() => {
    if (roster.length > 0 && Object.keys(draft).length === 0) {
      const initial: Record<number, LineupDraft> = {}
      for (const p of roster) {
        initial[p.id] = {
          player_id: p.id,
          is_starter: false,
          position_played: p.position ?? '',
          shirt_number: p.shirt_number ?? null,
        }
      }
      setDraft(initial)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roster])

  function togglePresent(p: RosterPlayer) {
    setDraft(prev => {
      const next = { ...prev }
      if (next[p.id]) delete next[p.id]
      else next[p.id] = {
        player_id: p.id, is_starter: false,
        position_played: p.position ?? '', shirt_number: p.shirt_number ?? null,
      }
      return next
    })
  }

  function toggleStarter(id: number) {
    setDraft(prev => ({
      ...prev,
      [id]: { ...prev[id], is_starter: !prev[id].is_starter }
    }))
  }

  const starters = Object.values(draft).filter(d => d.is_starter).length
  const subs     = Object.values(draft).filter(d => !d.is_starter).length

  async function save() {
    setBusy(true)
    try {
      await adminFetch(`/matches/${matchId}/lineup`, {
        method: 'PUT',
        body: JSON.stringify({
          team_id: teamId,
          players: Object.values(draft),
        }),
      })
      setFlash('Saved ✓')
      setTimeout(() => setFlash(null), 1500)
    } catch (e) {
      setFlash(`Error: ${e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02]">
      <div className="flex items-center justify-between gap-2 border-b border-white/5 bg-black/30 px-4 py-2.5">
        <span className="font-display text-sm tracking-wider text-cream">{teamLabel}</span>
        <span className="text-[10px] font-bold tracking-widest text-cream/40">
          <span className={clsx(starters === 11 ? 'text-amber-400' : 'text-live')}>{starters}/11 XI</span>
          {' · '}
          <span className="text-cream/60">{subs} subs</span>
        </span>
      </div>

      {roster.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-cream/40">
          No players in this squad yet. Add them to the <code className="text-amber-400">players</code> sheet and re-run the seeder.
        </div>
      ) : (
        <div className="max-h-96 overflow-y-auto">
          {roster.map(p => {
            const d = draft[p.id]
            const present = !!d
            const starter = d?.is_starter
            return (
              <div key={p.id} className={clsx(
                'flex items-center gap-3 px-3 py-1.5 text-sm transition-colors',
                present ? 'bg-white/[0.04]' : '',
                starter ? 'border-l-2 border-amber-400' : 'border-l-2 border-transparent'
              )}>
                <button
                  onClick={() => togglePresent(p)}
                  className={clsx(
                    'flex h-6 w-6 items-center justify-center rounded text-xs font-bold ring-1',
                    present ? 'bg-emerald-500/20 text-emerald-400 ring-emerald-400/40'
                            : 'bg-white/5 text-cream/30 ring-white/10'
                  )}
                  title="Toggle present"
                >
                  {present ? '✓' : '+'}
                </button>
                <button
                  onClick={() => present && toggleStarter(p.id)}
                  disabled={!present}
                  className={clsx(
                    'flex h-6 w-6 items-center justify-center rounded text-xs font-bold ring-1 transition-colors',
                    starter ? 'bg-amber-500/30 text-amber-400 ring-amber-400/40'
                            : present ? 'bg-white/5 text-cream/30 ring-white/10 hover:text-amber-400'
                                      : 'opacity-30'
                  )}
                  title="Toggle starter"
                >★</button>
                <span className="w-8 text-right font-mono text-xs text-cream/40">
                  {p.shirt_number ?? '–'}
                </span>
                <span className="flex-1 text-cream/85">{p.name}</span>
                <span className="font-mono text-[10px] text-cream/30">{p.position ?? ''}</span>
              </div>
            )
          })}
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-white/5 bg-black/20 px-4 py-2.5">
        <span className="text-[10px] text-cream/40">{flash ?? 'Unsaved changes are lost on reload'}</span>
        <button
          onClick={save}
          disabled={busy || roster.length === 0}
          className="rounded-lg bg-gold-gradient px-3 py-1.5 text-[11px] font-bold tracking-widest text-ink shadow-gold disabled:opacity-50"
        >
          {busy ? 'SAVING…' : 'SAVE LINEUP'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Team picker — only shown for knockout placeholder matches
// ---------------------------------------------------------------------------

function TeamPickerPanel({ match, onSaved }: {
  match: AdminMatchRow
  onSaved: () => Promise<void>
}) {
  const [teams, setTeams] = useState<AdminTeam[] | null>(null)
  const [homeId, setHomeId] = useState<number | ''>(match.home_id ?? '')
  const [awayId, setAwayId] = useState<number | ''>(match.away_id ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    adminFetch<AdminTeam[]>('/teams').then(setTeams).catch(e => setErr(String(e)))
  }, [])

  async function save() {
    setBusy(true)
    setErr(null)
    try {
      await adminFetch(`/matches/${match.id}/teams`, {
        method: 'PUT',
        body: JSON.stringify({
          home_team_id: homeId === '' ? null : Number(homeId),
          away_team_id: awayId === '' ? null : Number(awayId),
        }),
      })
      await onSaved()
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  // Distinguish "no teams set yet" vs "teams set, can be overridden"
  const teamsSet = match.home_id != null && match.away_id != null

  return (
    <section className="rounded-2xl border border-amber-400/30 bg-amber-500/[0.04] p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">
            {teamsSet ? 'KNOCKOUT MATCHUP' : 'KNOCKOUT PLACEHOLDER'}
          </div>
          <h2 className="font-display text-2xl tracking-wide text-cream">
            {teamsSet ? 'Override Teams' : 'Set Teams'}
          </h2>
          <p className="mt-1 text-xs text-cream/60">
            Once the previous round finishes, set the winners here. After saving,
            event and lineup panels will appear.
          </p>
        </div>
        <button
          onClick={save}
          disabled={busy || teams == null}
          className="rounded-xl bg-gold-gradient px-5 py-2.5 font-display tracking-wider text-ink shadow-gold transition-transform hover:scale-105 disabled:opacity-50 disabled:hover:scale-100"
        >
          {busy ? 'SAVING…' : 'SAVE TEAMS'}
        </button>
      </div>

      {teams == null ? (
        <div className="h-12 rounded-lg shimmer" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <TeamPickerField label="Home team" value={homeId} onChange={setHomeId} teams={teams} />
          <TeamPickerField label="Away team" value={awayId} onChange={setAwayId} teams={teams} />
        </div>
      )}

      {err && <div className="mt-3 text-xs text-live">{err}</div>}
    </section>
  )
}

function TeamPickerField({ label, value, onChange, teams }: {
  label: string
  value: number | ''
  onChange: (v: number | '') => void
  teams: AdminTeam[]
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-bold tracking-widest text-cream/40 mb-1">{label.toUpperCase()}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-cream focus:border-amber-400/50 focus:outline-none"
      >
        <option value="">— select team —</option>
        {teams.map(t => (
          <option key={t.id} value={t.id}>
            {t.code} · {t.name}{t.group_name ? ` (Group ${t.group_name})` : ''}
          </option>
        ))}
      </select>
    </label>
  )
}

// ---------------------------------------------------------------------------
// Stats entry panel
//
// Derived columns (Min/G/A/Y/R) are read-only — they refresh from
// events/lineup every fetch. Manual columns are inline-editable per row.
// Minutes can be overridden manually (e.g. for extra-time matches).
// ---------------------------------------------------------------------------

type EditableField =
  | 'minutes_played'
  | 'passes_completed' | 'passes_attempted'
  | 'tackles_made'
  | 'shots_total' | 'shots_on_target'
  | 'fouls_committed' | 'fouls_won'
  | 'saves' | 'goals_conceded'

function StatsPanel({ match }: { match: AdminMatchRow }) {
  const [rows,  setRows]  = useState<AdminStatRow[] | null>(null)
  const [err,   setErr]   = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const data = await adminFetch<AdminStatRow[]>(`/matches/${match.id}/stats`)
      setRows(data)
    } catch (e) {
      if (e instanceof AdminAuthError) { window.location.href = '/admin'; return }
      setErr(String(e))
    }
  }, [match.id])

  useEffect(() => { refresh() }, [refresh])

  if (err)   return <section className="rounded-2xl border border-live/30 panel p-6 text-sm text-live">{err}</section>
  if (rows === null) {
    return <section className="rounded-2xl border border-white/10 panel p-6"><div className="h-32 rounded shimmer" /></section>
  }

  return (
    <section className="rounded-2xl border border-white/10 panel p-6">
      <div className="mb-2">
        <div className="text-[10px] font-bold tracking-[0.3em] text-amber-400">PER-PLAYER STATS</div>
        <h2 className="font-display text-2xl tracking-wide text-cream">Player Statistics</h2>
        <p className="mt-1 text-xs text-cream/40">
          <span className="text-cream/70">Min / G / A / Y / R</span> auto-update from your lineup &amp; events.
          Fill in the rest as you watch.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 py-8 text-center text-sm text-cream/50">
          Save lineups first — stat rows appear here for every player you put in the XI or on the bench.
        </div>
      ) : (
        <div className="grid gap-6 mt-4 lg:grid-cols-2">
          <TeamStatsTable
            label={`${match.home_code ?? '?'} · ${match.home_name ?? 'Home'}`}
            matchId={match.id}
            teamId={match.home_id!}
            rows={rows.filter(r => r.team_id === match.home_id)}
            onRefresh={refresh}
          />
          <TeamStatsTable
            label={`${match.away_code ?? '?'} · ${match.away_name ?? 'Away'}`}
            matchId={match.id}
            teamId={match.away_id!}
            rows={rows.filter(r => r.team_id === match.away_id)}
            onRefresh={refresh}
          />
        </div>
      )}
    </section>
  )
}

function TeamStatsTable({ label, matchId, teamId, rows, onRefresh }: {
  label: string
  matchId: number
  teamId: number
  rows: AdminStatRow[]
  onRefresh: () => Promise<void>
}) {
  // Local draft — clones server rows so user edits stay local until SAVE
  const [draft, setDraft] = useState<AdminStatRow[]>(rows)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  // Per-player pass-accuracy %. We don't store this in the DB — only
  // passes_attempted (total) and passes_completed are persisted — but the
  // admin enters it directly, so we keep it as parallel UI state derived from
  // the saved totals. Reseeds whenever rows refresh.
  const [accDraft, setAccDraft] = useState<Record<number, number>>({})

  // Re-seed draft whenever upstream rows change (refresh or first load)
  useEffect(() => {
    setDraft(rows)
    const next: Record<number, number> = {}
    for (const r of rows) {
      next[r.player_id] = (r.passes_attempted ?? 0) > 0
        ? Math.round((r.passes_completed / r.passes_attempted) * 100)
        : 0
    }
    setAccDraft(next)
  }, [rows])

  function setField(pid: number, field: EditableField, value: number) {
    setDraft(prev => prev.map(r =>
      r.player_id === pid ? { ...r, [field]: value } : r
    ))
  }

  // Pass-total edit: re-derive completed from current accuracy %.
  function setPassTotal(pid: number, total: number) {
    const acc  = accDraft[pid] ?? 0
    const comp = Math.max(0, Math.min(total, Math.round(total * acc / 100)))
    setDraft(prev => prev.map(r =>
      r.player_id === pid
        ? { ...r, passes_attempted: total, passes_completed: comp }
        : r
    ))
  }

  // Pass-accuracy edit: clamp to 0..100, re-derive completed from current total.
  function setPassAcc(pid: number, acc: number) {
    const clamped = Math.max(0, Math.min(100, acc))
    const total   = draft.find(r => r.player_id === pid)?.passes_attempted ?? 0
    const comp    = Math.max(0, Math.min(total, Math.round(total * clamped / 100)))
    setAccDraft(prev => ({ ...prev, [pid]: clamped }))
    setDraft(prev => prev.map(r =>
      r.player_id === pid ? { ...r, passes_completed: comp } : r
    ))
  }

  async function save() {
    setBusy(true)
    setFlash(null)
    try {
      await adminFetch(`/matches/${matchId}/stats`, {
        method: 'PUT',
        body: JSON.stringify({
          rows: draft.map(r => ({
            player_id:        r.player_id,
            passes_completed: r.passes_completed,
            passes_attempted: r.passes_attempted,
            tackles_made:     r.tackles_made,
            shots_total:      r.shots_total,
            shots_on_target:  r.shots_on_target,
            fouls_committed:  r.fouls_committed,
            fouls_won:        r.fouls_won,
            saves:            r.saves,
            goals_conceded:   r.goals_conceded,
            minutes_played:   r.minutes_played,
          })),
        }),
      })
      setFlash('Saved ✓')
      setTimeout(() => setFlash(null), 1500)
      await onRefresh()
    } catch (e) {
      setFlash(`Error: ${e}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="overflow-clip rounded-xl border border-white/10 bg-white/[0.02]">
      <div className="flex items-center justify-between gap-2 border-b border-white/5 bg-black/30 px-4 py-2.5">
        <span className="font-display text-sm tracking-wider text-cream">{label}</span>
        <span className="text-[10px] font-bold tracking-widest text-cream/40">
          {draft.length} {draft.length === 1 ? 'PLAYER' : 'PLAYERS'}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-black/80 backdrop-blur sticky top-0 z-20 text-[10px] font-bold tracking-widest text-cream/40">
            <tr>
              {/* Portrait phone shows the at-a-glance derived snapshot only
                  (MIN/G/A/Y/R). Landscape phone + tablets+ show the full
                  editable form. Rotate your phone to enter the wider stats. */}
              <th className="px-2 py-2 text-left sticky left-0 z-10 bg-black/40 min-w-[160px]">PLAYER</th>
              <th className="px-1.5 py-2 text-center">MIN</th>
              <th className="px-1.5 py-2 text-center text-gold">G</th>
              <th className="px-1.5 py-2 text-center text-emerald-400">A</th>
              <th className="px-1.5 py-2 text-center">Y</th>
              <th className="px-1.5 py-2 text-center">R</th>
              <th className="hidden landscape:table-cell sm:table-cell px-1.5 py-2 text-center">TOT</th>
              <th className="hidden landscape:table-cell sm:table-cell px-1.5 py-2 text-center">ACC%</th>
              <th className="hidden landscape:table-cell sm:table-cell px-1.5 py-2 text-center">F+</th>
              <th className="hidden landscape:table-cell sm:table-cell px-1.5 py-2 text-center">F-</th>
              <th className="hidden landscape:table-cell sm:table-cell px-1.5 py-2 text-center">SH</th>
              <th className="hidden landscape:table-cell sm:table-cell px-1.5 py-2 text-center">SOT</th>
              <th className="hidden landscape:table-cell sm:table-cell px-1.5 py-2 text-center text-amber-400">SV</th>
              <th className="hidden landscape:table-cell sm:table-cell px-1.5 py-2 text-center text-live/80">GA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {draft.map(r => {
              const isGK = r.player_position === 'GK'
              return (
                <tr key={r.player_id} className="hover:bg-white/[0.03]">
                  <td className="px-2 py-1.5 sticky left-0 z-10 bg-ink/95">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[10px] text-cream/40 w-6 text-right">
                        {r.player_shirt ?? '–'}
                      </span>
                      <span className={clsx(
                        'truncate text-xs font-semibold',
                        r.is_starter ? 'text-cream' : 'text-cream/60'
                      )}>
                        {r.player_name}
                      </span>
                      {r.is_starter ? (
                        <span className="shrink-0 text-[8px] font-bold text-amber-400">★</span>
                      ) : (
                        <span className="shrink-0 text-[8px] font-bold text-cream/30">S</span>
                      )}
                    </div>
                  </td>

                  {/* Editable: minutes */}
                  <StatCell value={r.minutes_played} onChange={v => setField(r.player_id, 'minutes_played', v)} />

                  {/* Read-only derived */}
                  <ReadCell value={r.goals}    accent={r.goals > 0 ? 'gold' : undefined} />
                  <ReadCell value={r.assists}  accent={r.assists > 0 ? 'emerald' : undefined} />
                  <ReadCell value={r.yellow_cards} accent={r.yellow_cards > 0 ? 'amber' : undefined} />
                  <ReadCell value={r.red_cards}    accent={r.red_cards > 0 ? 'live' : undefined} />

                  {/* Editable manual columns — hidden in portrait so the
                      mobile snapshot stays at-a-glance. Rotate to edit. */}
                  {/* Total passes attempted (the admin enters this) */}
                  <StatCell value={r.passes_attempted} onChange={v => setPassTotal(r.player_id, v)} hideOnPortrait />
                  {/* Pass accuracy %, clamped 0..100. passes_completed = round(total * acc/100) */}
                  <StatCell value={accDraft[r.player_id] ?? 0} onChange={v => setPassAcc(r.player_id, v)} hideOnPortrait max={100} />
                  <StatCell value={r.fouls_won}        onChange={v => setField(r.player_id, 'fouls_won',        v)} hideOnPortrait />
                  <StatCell value={r.fouls_committed}  onChange={v => setField(r.player_id, 'fouls_committed',  v)} hideOnPortrait />
                  <StatCell value={r.shots_total}      onChange={v => setField(r.player_id, 'shots_total',      v)} hideOnPortrait />
                  <StatCell value={r.shots_on_target}  onChange={v => setField(r.player_id, 'shots_on_target',  v)} hideOnPortrait />
                  <StatCell value={r.saves}            onChange={v => setField(r.player_id, 'saves',            v)} dim={!isGK} hideOnPortrait />
                  <StatCell value={r.goals_conceded}   onChange={v => setField(r.player_id, 'goals_conceded',   v)} dim={!isGK} hideOnPortrait />
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-white/5 bg-black/20 px-4 py-2.5">
        <span className="text-[10px] text-cream/40">
          {flash ?? 'TOT total passes · ACC pass accuracy % · F+/F- fouls won/committed · SH shots · SOT on target · SV saves · GA conceded'}
        </span>
        <button
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-gold-gradient px-3 py-1.5 text-[11px] font-bold tracking-widest text-ink shadow-gold disabled:opacity-50"
        >
          {busy ? 'SAVING…' : 'SAVE STATS'}
        </button>
      </div>
    </div>
  )
}

function StatCell({ value, onChange, dim, hideOnPortrait, max }: {
  value: number
  onChange: (v: number) => void
  dim?: boolean
  hideOnPortrait?: boolean
  max?: number
}) {
  return (
    <td className={clsx(
      'px-1 py-1',
      hideOnPortrait && 'hidden landscape:table-cell sm:table-cell'
    )}>
      <input
        type="number"
        min={0}
        max={max}
        value={value}
        onChange={e => {
          if (e.target.value === '') { onChange(0); return }
          let n = Math.max(0, Number(e.target.value))
          if (max != null) n = Math.min(max, n)
          onChange(n)
        }}
        onFocus={e => e.target.select()}
        className={clsx(
          'w-12 rounded border border-white/10 bg-black/30 px-1 py-0.5 text-center font-mono text-xs tabular-nums focus:border-amber-400/50 focus:outline-none',
          dim ? 'text-cream/30' : 'text-cream'
        )}
      />
    </td>
  )
}

function ReadCell({ value, accent, hideOnPortrait }: {
  value: number
  accent?: 'gold' | 'emerald' | 'amber' | 'live'
  hideOnPortrait?: boolean
}) {
  const cls = {
    gold: 'text-gold font-bold',
    emerald: 'text-emerald-400 font-bold',
    amber: 'text-amber-400 font-bold',
    live: 'text-live font-bold',
  }
  return (
    <td className={clsx(
      'px-1.5 py-1.5 text-center font-mono text-xs tabular-nums',
      hideOnPortrait && 'hidden landscape:table-cell sm:table-cell',
      accent ? cls[accent] : value === 0 ? 'text-cream/25' : 'text-cream/70'
    )}>
      {value}
    </td>
  )
}
