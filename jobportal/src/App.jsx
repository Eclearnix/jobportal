import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import DashboardPage, { JobDetailsPage } from './pages/DashboardPage'
import LoginPage from './pages/LoginPage'
import OnboardingPage from './pages/OnboardingPage'
import './App.css'

function SuperAdminPortalRedirect() {
  const adminUrl = import.meta.env.VITE_SUPER_ADMIN_URL
  useEffect(() => {
    if (adminUrl) window.location.replace(adminUrl)
  }, [adminUrl])
  return adminUrl
    ? <PageLoader />
    : <div className="workspace-error" role="alert">Super Admin access is handled by a separate app. Configure VITE_SUPER_ADMIN_URL to continue.</div>
}

function PageLoader() {
  return <div className="workspace-loading" role="status"><span className="loading-spinner" />Loading your secure workspace…</div>
}

function HomeRedirect() {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" replace />
  if (user.role === 'super_admin') return <SuperAdminPortalRedirect />
  if (user.role === 'candidate' && (!user.phone || !user.location)) return <Navigate to="/onboarding/candidate" replace />
  if (user.role === 'recruiter' && !user.company) return <Navigate to="/onboarding/recruiter" replace />
  return <Navigate to={user.role === 'candidate' ? '/candidate' : '/organization'} replace />
}

function ProtectedRoute({ role, children }) {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== role) {
    if (user.role === 'super_admin') return <SuperAdminPortalRedirect />
    const destination = user.role === 'candidate' ? '/candidate' : '/organization'
    return <Navigate to={destination} replace />
  }
  if (role === 'candidate' && (!user.phone || !user.location)) return <Navigate to="/onboarding/candidate" replace />
  if (role === 'recruiter' && !user.company) return <Navigate to="/onboarding/recruiter" replace />
  return children
}

function LoginRoute() {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />
  if (user) {
    if (user.role === 'super_admin') return <SuperAdminPortalRedirect />
    if (user.role === 'candidate' && (!user.phone || !user.location)) return <Navigate to="/onboarding/candidate" replace />
    if (user.role === 'recruiter' && !user.company) return <Navigate to="/onboarding/recruiter" replace />
    return <Navigate to={user.role === 'candidate' ? '/candidate' : '/organization'} replace />
  }
  return <LoginPage />
}

function OnboardingRoute({ role }) {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" replace />
  if (user.role !== role) return <HomeRedirect />
  if (role === 'candidate' && user.phone && user.location) return <Navigate to="/candidate" replace />
  if (role === 'recruiter' && user.company) return <Navigate to="/organization" replace />
  return <OnboardingPage role={role} />
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<HomeRedirect />} />
      <Route path="/login" element={<LoginRoute />} />
      <Route path="/onboarding/candidate" element={<OnboardingRoute role="candidate" />} />
      <Route path="/onboarding/recruiter" element={<OnboardingRoute role="recruiter" />} />
      <Route path="/jobs/:jobId" element={<ProtectedRoute role="candidate"><JobDetailsPage /></ProtectedRoute>} />
      <Route path="/candidate" element={<ProtectedRoute role="candidate"><DashboardPage role="candidate" /></ProtectedRoute>} />
      <Route path="/candidate/:section" element={<ProtectedRoute role="candidate"><DashboardPage role="candidate" /></ProtectedRoute>} />
      <Route path="/organization" element={<ProtectedRoute role="recruiter"><DashboardPage role="recruiter" /></ProtectedRoute>} />
      <Route path="/organization/:section" element={<ProtectedRoute role="recruiter"><DashboardPage role="recruiter" /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function App() {
  return <AuthProvider><BrowserRouter><AppRoutes /></BrowserRouter></AuthProvider>
}

export default App
