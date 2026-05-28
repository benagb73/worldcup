import useSWR from 'swr'

const fetcher = (url: string) => fetch(url).then(r => r.json())

const API = process.env.NEXT_PUBLIC_API_URL || ''

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
