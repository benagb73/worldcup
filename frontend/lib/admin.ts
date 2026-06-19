'use client'

/**
 * Tiny admin-API helper.
 *
 * The admin secret is stored in localStorage under `wc-admin-secret` and
 * automatically attached to every request as an X-Admin-Secret header.
 * A 403 from any call clears the secret and forces a re-login.
 */

const SECRET_KEY = 'wc-admin-secret'

export function getSecret(): string | null {
  if (typeof window === 'undefined') return null
  return window.localStorage.getItem(SECRET_KEY)
}

export function setSecret(value: string): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SECRET_KEY, value)
}

export function clearSecret(): void {
  if (typeof window === 'undefined') return
  window.localStorage.removeItem(SECRET_KEY)
}

const API = process.env.NEXT_PUBLIC_API_URL || ''

export async function adminFetch<T = any>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const secret = getSecret()
  if (!secret) throw new AdminAuthError('No admin secret stored')

  const headers = new Headers(init.headers)
  headers.set('X-Admin-Secret', secret)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const res = await fetch(`${API}/api/admin${path}`, { ...init, headers })

  if (res.status === 403) {
    clearSecret()
    throw new AdminAuthError('Invalid admin secret')
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Admin API ${res.status}: ${text || res.statusText}`)
  }
  // Some endpoints (DELETE) may have empty bodies
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) return res.json()
  return undefined as T
}

export class AdminAuthError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'AdminAuthError'
  }
}

// --- Typed shapes for admin endpoints --------------------------------------

export interface AdminMatchRow {
  id: number
  match_number: number | null
  stage: string
  group_name: string | null
  scheduled_at: string
  status: string
  ht_home: number | null
  ht_away: number | null
  ft_home: number | null
  ft_away: number | null
  et_home: number | null
  et_away: number | null
  pen_home: number | null
  pen_away: number | null
  winner_id: number | null
  // Teams may be null on knockout placeholder rows
  home_id: number | null
  home_name: string | null
  home_code: string | null
  home_flag: string | null
  away_id: number | null
  away_name: string | null
  away_code: string | null
  away_flag: string | null
  attendance: number | null
  venue_capacity: number | null
}

export interface AdminTeam {
  id: number
  name: string
  code: string
  group_name: string | null
  flag_url: string | null
  world_rank: number | null
}

export interface AdminEvent {
  id: number
  match_id: number
  team_id: number
  team_code: string
  player_id: number
  player_name: string
  event_type: string
  minute: number
  added_time: number
  period: string
  is_penalty: number
  is_own_goal: number
  related_event_id: number | null
}

export interface RosterPlayer {
  id: number
  name: string
  shirt_number: number | null
  position: string | null
}

export interface AdminStatRow {
  match_id: number
  team_id: number
  team_code: string
  player_id: number
  player_name: string
  player_position: string | null
  player_shirt: number | null
  is_starter: number   // 0 / 1
  // Derived (read-only in the UI)
  minutes_played: number
  goals: number
  assists: number
  yellow_cards: number
  red_cards: number
  // Manual / editable
  passes_completed: number
  passes_attempted: number
  tackles_made: number
  shots_total: number
  shots_on_target: number
  fouls_committed: number
  fouls_won: number
  saves: number
  goals_conceded: number
}
