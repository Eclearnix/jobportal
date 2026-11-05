import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from '../services/api'

const AuthContext = createContext(null)

const authEndpoints = {
  candidate: '/auth/google/candidate',
  recruiter: '/auth/google/organization',
  super_admin: '/auth/google/super-admin',
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  const [authError, setAuthError] = useState('')

  const refreshUser = useCallback(async () => {
    try {
      const { user: currentUser } = await api('/auth/me')
      setUser(currentUser)
      setAuthError('')
      return currentUser
    } catch (error) {
      if (error.message === 'Authentication required.' || error.message === 'Session is invalid or expired.' || error.message === 'Session is no longer active.') {
        setUser(null)
        setAuthError('')
        return null
      }
      setAuthError(error.message)
      throw error
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshUser().catch(() => {})
  }, [refreshUser])

  const signInWithGoogle = useCallback(async (role, credential) => {
    const endpoint = authEndpoints[role]
    if (!endpoint) throw new Error('Choose a valid account type.')
    const response = await api(endpoint, { method: 'POST', body: { credential } })
    setUser(response.user)
    setAuthError('')
    return response
  }, [])

  const signOut = useCallback(async () => {
    try {
      await api('/auth/logout', { method: 'POST' })
    } finally {
      setUser(null)
    }
  }, [])

  const value = useMemo(() => ({
    user,
    loading,
    authError,
    signInWithGoogle,
    signOut,
    refreshUser,
  }), [user, loading, authError, signInWithGoogle, signOut, refreshUser])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used within AuthProvider.')
  return value
}
