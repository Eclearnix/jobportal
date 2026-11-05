import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import DashboardPage, { JobDetailsPage } from './pages/DashboardPage'
import LoginPage from './pages/LoginPage'
import OnboardingPage from './pages/OnboardingPage'
import './App.css'

function PageLoader() {
  return <div className="workspace-loading" role="status"><span className="loading-spinner" />Loading your secure workspace…</div>
}

function HomeRedirect() {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to="/login" replace />
  if (user.role === 'candidate' && (!user.phone || !user.location)) return <Navigate to="/onboarding/candidate" replace />
  if (user.role === 'recruiter' && !user.company) return <Navigate to="/onboarding/recruiter" replace />
  return <Navigate to={user.role === 'candidate' ? '/candidate' : user.role === 'recruiter' ? '/organization' : '/super-admin'} replace />
}

function ProtectedRoute({ role, children }) {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />
  if (!user) return <Navigate to={role === 'super_admin' ? '/super-admin/login' : '/login'} replace />
  if (user.role !== role) {
    const destination = user.role === 'candidate' ? '/candidate' : user.role === 'recruiter' ? '/organization' : '/super-admin'
    return <Navigate to={destination} replace />
  }
  if (role === 'candidate' && (!user.phone || !user.location)) return <Navigate to="/onboarding/candidate" replace />
  if (role === 'recruiter' && !user.company) return <Navigate to="/onboarding/recruiter" replace />
  return children
}

function LoginRoute({ superAdmin = false }) {
  const { user, loading } = useAuth()
  if (loading) return <PageLoader />
  if (user) {
    if (user.role === 'candidate' && (!user.phone || !user.location)) return <Navigate to="/onboarding/candidate" replace />
    if (user.role === 'recruiter' && !user.company) return <Navigate to="/onboarding/recruiter" replace />
    return <Navigate to={user.role === 'candidate' ? '/candidate' : user.role === 'recruiter' ? '/organization' : '/super-admin'} replace />
  }
  return <LoginPage superAdmin={superAdmin} />
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
      <Route path="/super-admin/login" element={<LoginRoute superAdmin />} />
      <Route path="/onboarding/candidate" element={<OnboardingRoute role="candidate" />} />
      <Route path="/onboarding/recruiter" element={<OnboardingRoute role="recruiter" />} />
      <Route path="/jobs/:jobId" element={<ProtectedRoute role="candidate"><JobDetailsPage /></ProtectedRoute>} />
      <Route path="/candidate" element={<ProtectedRoute role="candidate"><DashboardPage role="candidate" /></ProtectedRoute>} />
      <Route path="/candidate/:section" element={<ProtectedRoute role="candidate"><DashboardPage role="candidate" /></ProtectedRoute>} />
      <Route path="/organization" element={<ProtectedRoute role="recruiter"><DashboardPage role="recruiter" /></ProtectedRoute>} />
      <Route path="/organization/:section" element={<ProtectedRoute role="recruiter"><DashboardPage role="recruiter" /></ProtectedRoute>} />
      <Route path="/super-admin" element={<ProtectedRoute role="super_admin"><DashboardPage role="super_admin" /></ProtectedRoute>} />
      <Route path="/super-admin/:section" element={<ProtectedRoute role="super_admin"><DashboardPage role="super_admin" /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

function App() {
  return <AuthProvider><BrowserRouter><AppRoutes /></BrowserRouter></AuthProvider>
}

export default App
