/* Pipelines are separate workspaces shown under "Recents" (like chats). */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, pipelineStore } from './api'
import type { Pipeline } from './types'

interface PipelinesCtx {
  list: Pipeline[]
  current: Pipeline | null
  loading: boolean
  select: (id: string) => void
  create: () => Promise<Pipeline>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
  clearAll: () => Promise<void>
  refresh: () => Promise<void>
}

/** A pipeline with no data yet. It isn't listed in Recents until something is uploaded. */
export const isEmptyPipeline = (p: Pipeline) => !p.stats.deals && !p.stats.activities && !p.stats.running

const Ctx = createContext<PipelinesCtx | null>(null)

export function PipelinesProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Pipeline[]>([])
  const [currentId, setCurrentId] = useState<string | null>(pipelineStore.get())
  const [loading, setLoading] = useState(true)

  const select = useCallback((id: string) => {
    pipelineStore.set(id)
    setCurrentId(id)
  }, [])

  const refresh = useCallback(async () => {
    const items = await api<Pipeline[]>('/api/pipelines')
    setList(items)
    const saved = pipelineStore.get()
    if (!saved || !items.some((p) => p.id === saved)) {
      if (items[0]) select(items[0].id)
    }
  }, [select])

  useEffect(() => { refresh().finally(() => setLoading(false)) }, [refresh])

  const value = useMemo<PipelinesCtx>(() => ({
    list,
    current: list.find((p) => p.id === currentId) || null,
    loading,
    select,
    refresh,
    create: async () => {
      const p = await api<Pipeline>('/api/pipelines', { body: {} })
      setList((xs) => [p, ...xs.filter((x) => x.id !== p.id)])
      select(p.id)
      return p
    },
    rename: async (id, name) => {
      const p = await api<Pipeline>(`/api/pipelines/${id}`, { method: 'PATCH', body: { name } })
      setList((xs) => xs.map((x) => (x.id === id ? p : x)))
    },
    remove: async (id) => {
      await api(`/api/pipelines/${id}`, { method: 'DELETE' })
      if (id === currentId) pipelineStore.set(null)
      await refresh()
    },
    clearAll: async () => {
      await api('/api/pipelines', { method: 'DELETE' })
      pipelineStore.set(null)
      await refresh()
    },
  }), [list, currentId, loading, select, refresh])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePipelines(): PipelinesCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('usePipelines outside PipelinesProvider')
  return v
}
