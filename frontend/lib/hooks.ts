import useSWR from 'swr'
import { isOwner } from './compete'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const API = process.env.NEXT_PUBLIC_API_URL || ''

/**
 * Picks-specific fetcher — if the viewer is the owner of this competitor (per
 * localStorage), sends X-Competitor-Id so the server returns pre-kickoff picks.
 */
function picksFetcher(competitorId: number) {
  return (url: string) => {
    const headers: HeadersInit = {}
    if (isOwner(competitorId)) headers['X-Competitor-Id'] = String(competitorId)
    return fetch(url, { headers }).then(r => r.json())
  }
}

// Poll every 60s for live matches, 5min otherwise
const LIVE_REFRESH   = 60_000
const STATIC_REFRESH = 300_000

export function useGroups() {
  return useSWR(`${API}/api/groups`, fetcher, { refreshInterval: LIVE_REFRESH })
}

export function useMatches(params?: { stage?: string; group?: string; status?: string }) {
  const qs = new URLSearchParams(params as Record<string, string>).toString()
  return useSWR(`${API}/api/matches${qs ? '?' + qs : ''}`, fetcher, {
    refreshInterval: LIVE_REFRESH,
  })
}

export function useMatch(id: number | string) {
  return useSWR(`${API}/api/matches/${id}`, fetcher, {
    refreshInterval: LIVE_REFRESH,
  })
}

export function usePlayer(id: number | string) {
  return useSWR(`${API}/api/players/${id}`, fetcher, {
    refreshInterval: STATIC_REFRESH,
  })
}

export function usePlayerStats(id: number | string) {
  return useSWR(`${API}/api/players/${id}/stats`, fetcher, {
    refreshInterval: STATIC_REFRESH,
  })
}

export function useBracket() {
  return useSWR(`${API}/api/bracket`, fetcher, { refreshInterval: LIVE_REFRESH })
}

export function useTeam(id: number | string) {
  return useSWR(`${API}/api/teams/${id}`, fetcher, { refreshInterval: LIVE_REFRESH })
}

export function useLeaderboard() {
  return useSWR(`${API}/api/leaderboard`, fetcher, { refreshInterval: LIVE_REFRESH })
}

// ---- Competition ---------------------------------------------------------

export function useCompetitors() {
  return useSWR(`${API}/api/compete/competitors`, fetcher, { refreshInterval: LIVE_REFRESH })
}

export function useCompetitor(id: number | string) {
  return useSWR(`${API}/api/compete/competitors/${id}`, fetcher, { refreshInterval: LIVE_REFRESH })
}

export function useCompetitorPicks(id: number | string) {
  return useSWR(
    `${API}/api/compete/competitors/${id}/picks`,
    picksFetcher(Number(id)),
    { refreshInterval: LIVE_REFRESH }
  )
}

export function useMatchPicks(matchId: number | string) {
  return useSWR(`${API}/api/compete/matches/${matchId}/picks`, fetcher, { refreshInterval: LIVE_REFRESH })
}

export function useScoringConfig() {
  return useSWR(`${API}/api/compete/scoring`, fetcher, { refreshInterval: STATIC_REFRESH })
}

export function useTeamRoster(teamId: number | string | null) {
  return useSWR(
    teamId ? `${API}/api/teams/${teamId}/roster` : null,
    fetcher, { refreshInterval: STATIC_REFRESH }
  )
}
