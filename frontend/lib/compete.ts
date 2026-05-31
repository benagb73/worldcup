'use client'

/**
 * Tiny fetch helper for the family-competition endpoints.
 *
 * "Owner identity" is stored client-side in localStorage. When viewing your
 * own picks page, we send the id back to the server so it returns open-match
 * picks too. Viewing someone else's page sends no id (or a different one),
 * and the server scrubs pre-kickoff picks. Honor-system security only.
 */

const API = process.env.NEXT_PUBLIC_API_URL || ''
const OWNED_KEY = 'wc-owned-competitor-ids'

/** Mark the local browser as the owner of this competitor id. */
export function markAsOwner(id: number): void {
  if (typeof window === 'undefined') return
  const cur = ownedIds()
  if (!cur.includes(id)) cur.push(id)
  window.localStorage.setItem(OWNED_KEY, JSON.stringify(cur))
}

export function ownedIds(): number[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(OWNED_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((n: any) => typeof n === 'number') : []
  } catch {
    return []
  }
}

export function isOwner(id: number): boolean {
  return ownedIds().includes(id)
}

export class CompeteError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message); this.name = 'CompeteError'; this.status = status
  }
}

export async function competeFetch<T = any>(
  path: string, init: RequestInit = {}, asCompetitorId?: number,
): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  // If a competitor id was provided AND this browser is its owner, identify ourselves
  if (asCompetitorId !== undefined && isOwner(asCompetitorId)) {
    headers.set('X-Competitor-Id', String(asCompetitorId))
  }
  const res = await fetch(`${API}/api/compete${path}`, { ...init, headers })
  if (!res.ok) {
    let msg = res.statusText
    try {
      const body = await res.json()
      if (body?.detail) msg = String(body.detail)
    } catch { /* ignore */ }
    throw new CompeteError(msg, res.status)
  }
  const ct = res.headers.get('content-type') ?? ''
  if (ct.includes('application/json')) return res.json()
  return undefined as T
}

// Pretty label per joker bucket
export const BUCKET_LABEL: Record<string, string> = {
  'group-1':    'Group · Matchday 1',
  'group-2':    'Group · Matchday 2',
  'group-3':    'Group · Matchday 3',
  'r32':        'Round of 32',
  'r16':        'Round of 16',
  'qf':         'Quarter-final',
  'sf':         'Semi-final',
  'final':      'Final',
  'third_place': 'Third-Place Playoff',
}
