import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, tokenStore } from './api'
import type { User } from './types'

interface AuthCtx {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (name: string, email: string, password: string) => Promise<void>
  logout: () => void
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!tokenStore.get()) { setLoading(false); return }
    api<User>('/api/auth/me')
      .then(setUser)
      .catch(() => tokenStore.set(null))
      .finally(() => setLoading(false))
  }, [])

  const logout = useCallback(() => { tokenStore.set(null); setUser(null) }, [])

  useEffect(() => {
    const on = () => logout()
    window.addEventListener('dr-unauthorized', on)
    return () => window.removeEventListener('dr-unauthorized', on)
  }, [logout])

  const value = useMemo<AuthCtx>(() => ({
    user,
    loading,
    logout,
    login: async (email, password) => {
      const r = await api<{ token: string; user: User }>('/api/auth/login', { body: { email, password } })
      tokenStore.set(r.token)
      setUser(r.user)
    },
    register: async (name, email, password) => {
      const r = await api<{ token: string; user: User }>('/api/auth/register', { body: { name, email, password } })
      tokenStore.set(r.token)
      setUser(r.user)
    },
  }), [user, loading, logout])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth outside AuthProvider')
  return v
}
