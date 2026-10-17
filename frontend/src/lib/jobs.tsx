/* Tracks background analysis runs for the current pipeline.
   - `live` is the run shown as a flow chart (running, or just finished until dismissed).
   - `refreshKey` bumps whenever a run finishes, so pages reload their data. */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from './api'
import { usePipelines } from './pipelines'
import { useToast } from './toast'
import type { Job } from './types'

interface JobsCtx {
  active: Job[]
  live: Job | null
  refreshKey: number
  track: (job: Job | null | undefined, quiet?: boolean) => void
  cancel: (jobId: string) => Promise<void>
  dismiss: () => void
  refresh: () => void
}

const Ctx = createContext<JobsCtx | null>(null)
const isActive = (j: Job) => j.status === 'queued' || j.status === 'running'

export function JobsProvider({ children }: { children: ReactNode }) {
  const { current, refresh: refreshPipelines } = usePipelines()
  const pipelineId = current?.id
  const [active, setActive] = useState<Job[]>([])
  const [live, setLive] = useState<Job | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const quiet = useRef(new Set<string>())
  const toast = useToast()

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  const track = useCallback((job: Job | null | undefined, isQuiet = false) => {
    if (!job) return
    if (isQuiet) quiet.current.add(job.id)
    else setLive(job)
    if (isActive(job)) setActive((xs) => (xs.some((j) => j.id === job.id) ? xs : [...xs, job]))
    else { refresh(); refreshPipelines() }
  }, [refresh, refreshPipelines])

  // On pipeline switch: forget old runs and pick up any run still going in this pipeline.
  useEffect(() => {
    setActive([]); setLive(null)
    if (!pipelineId) return
    api<Job[]>('/api/jobs', { params: { active: true } })
      .then((js) => js.forEach((j) => track(j, j.trigger === 'action_update')))
      .catch(() => {})
  }, [pipelineId, track])

  useEffect(() => {
    if (!active.length) return
    const t = setInterval(async () => {
      const updated = await Promise.all(active.map((j) => api<Job>(`/api/jobs/${j.id}`).catch(() => j)))
      setLive((l) => (l ? updated.find((u) => u.id === l.id) || l : l))
      const finished = updated.filter((j) => !isActive(j))
      if (finished.length) {
        refresh()
        refreshPipelines()
        finished.forEach((j) => {
          if (j.status === 'failed') toast.push('error', 'Analysis failed', j.label || undefined)
          else if (j.status === 'done' && quiet.current.has(j.id)) toast.push('success', 'Deal re-checked')
        })
      }
      setActive(updated.filter(isActive))
    }, 900)
    return () => clearInterval(t)
  }, [active, refresh, refreshPipelines, toast])

  const cancel = useCallback(async (jobId: string) => {
    const j = await api<Job>(`/api/jobs/${jobId}/cancel`, { method: 'POST' })
    setLive((l) => (l && l.id === jobId ? j : l))
    setActive((xs) => xs.filter((x) => x.id !== jobId))
    refresh()
    refreshPipelines()
  }, [refresh, refreshPipelines])

  const value = useMemo(() => ({ active, live, refreshKey, track, cancel, refresh, dismiss: () => setLive(null) }),
    [active, live, refreshKey, track, cancel, refresh])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useJobs(): JobsCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useJobs outside JobsProvider')
  return v
}
