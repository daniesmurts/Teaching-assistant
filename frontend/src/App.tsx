import { useEffect, useRef } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import { initMetrica, metricaHit, isPublicPath } from './lib/metrica'
import { getMe } from './api/auth'
import AppShell from './components/layout/AppShell'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import PaymentResult from './pages/PaymentResult'
import Dashboard from './pages/Dashboard'
import Courses from './pages/Courses'
import Grading from './pages/Grading'
import Rubrics from './pages/Rubrics'
import Students from './pages/Students'
import History from './pages/History'
import Presentations from './pages/Presentations'
import Topics from './pages/Topics'
import Billing from './pages/Billing'
import Settings from './pages/Settings'
import Help from './pages/Help'
import Feedback from './pages/Feedback'
import AdminLayout from './pages/admin/AdminLayout'
import AdminOverview from './pages/admin/AdminOverview'
import AdminUsage from './pages/admin/AdminUsage'
import AdminTeachers from './pages/admin/AdminTeachers'
import AdminRubrics from './pages/admin/AdminRubrics'
import AdminInstitutions from './pages/admin/AdminInstitutions'
import AdminFeedback from './pages/admin/AdminFeedback'
import AdminErrors from './pages/admin/AdminErrors'
import InstitutionLayout from './pages/institution/InstitutionLayout'
import InstitutionOverview from './pages/institution/InstitutionOverview'
import InstitutionUsage from './pages/institution/InstitutionUsage'
import InstitutionTeachers from './pages/institution/InstitutionTeachers'
import InstitutionRubrics from './pages/institution/InstitutionRubrics'
import InstitutionAudit from './pages/institution/InstitutionAudit'
import Landing from './pages/Landing'
import About from './pages/About'
import Institutions from './pages/Institutions'
import FAQ from './pages/FAQ'
import Ethics from './pages/Ethics'
import Contact from './pages/Contact'
import Pricing from './pages/Pricing'
import Changelog from './pages/Changelog'
import UseCases from './pages/UseCases'
import Offer from './pages/legal/Offer'
import Privacy from './pages/legal/Privacy'
import Terms from './pages/legal/Terms'
import Cookies from './pages/legal/Cookies'

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
})

// Drive Yandex Metrica for logged-out visitors on public pages only.
// Authenticated pages show student PII, so we never init the counter there
// (and a hard reload on login tears down any replay session — see useAuth.ts).
// initMetrica() counts the first view itself, so the initial mount skips the hit.
function RouteTracker() {
  const location = useLocation()
  const token = useAuthStore((s) => s.token)
  const first = useRef(true)
  useEffect(() => {
    if (token || !isPublicPath(location.pathname)) return
    initMetrica()
    if (first.current) { first.current = false; return }
    metricaHit(window.location.href)
  }, [location, token])
  return null
}

// On every app load, reconcile the cached teacher + plan with the server.
// The plan is persisted in localStorage and otherwise only refreshed at login,
// so an upgrade confirmed elsewhere (e.g. T-Bank webhook) wouldn't show until
// re-login without this. Silent + non-blocking; a 401 is handled by the client.
function PlanSync() {
  const token = useAuthStore((s) => s.token)
  const updateAccount = useAuthStore((s) => s.updateAccount)
  useEffect(() => {
    if (!token) return
    getMe()
      .then(({ teacher, plan }) => updateAccount(teacher, plan))
      .catch(() => { /* non-fatal — keep cached values */ })
  }, [token, updateAccount])
  return null
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.token)
  return token ? <>{children}</> : <Navigate to="/login" replace />
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const teacher = useAuthStore((s) => s.teacher)
  if (!teacher) return <Navigate to="/login" replace />
  if (teacher.role !== 'platform_admin') return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

function InstitutionRoute({ children }: { children: React.ReactNode }) {
  const teacher = useAuthStore((s) => s.teacher)
  if (!teacher) return <Navigate to="/login" replace />
  if (teacher.role !== 'institution_admin' && teacher.role !== 'platform_admin') {
    return <Navigate to="/dashboard" replace />
  }
  return <>{children}</>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <PlanSync />
        <RouteTracker />
        <Routes>
          <Route path="/"         element={<Landing />} />
          <Route path="/about"    element={<About />} />
          <Route path="/institutions" element={<Institutions />} />
          <Route path="/faq"      element={<FAQ />} />
          <Route path="/ethics"   element={<Ethics />} />
          <Route path="/contact"  element={<Contact />} />
          <Route path="/pricing"  element={<Pricing />} />
          <Route path="/changelog" element={<Changelog />} />
          <Route path="/use-cases" element={<UseCases />} />
          <Route path="/offer"    element={<Offer />} />
          <Route path="/privacy"  element={<Privacy />} />
          <Route path="/terms"    element={<Terms />} />
          <Route path="/cookies"  element={<Cookies />} />
          <Route path="/login"            element={<Login />} />
          <Route path="/register"         element={<Register />} />
          <Route path="/forgot-password"  element={<ForgotPassword />} />
          <Route path="/reset-password"   element={<ResetPassword />} />
          <Route path="/payment/result"   element={<PaymentResult />} />
          <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
            <Route path="/dashboard"     element={<Dashboard />} />
            <Route path="/courses"       element={<Courses />} />
            <Route path="/grading"       element={<Grading />} />
            <Route path="/rubrics"       element={<Rubrics />} />
            <Route path="/students"      element={<Students />} />
            <Route path="/history"       element={<History />} />
            <Route path="/presentations" element={<Presentations />} />
            <Route path="/topics"        element={<Topics />} />
            <Route path="/billing"       element={<Billing />} />
            <Route path="/settings"      element={<Settings />} />
            <Route path="/help"          element={<Help />} />
            <Route path="/feedback"      element={<Feedback />} />
          </Route>
          {/* Admin — platform_admin only, own layout, direct URL access */}
          <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
            <Route index            element={<AdminOverview />} />
            <Route path="usage"     element={<AdminUsage />} />
            <Route path="teachers"  element={<AdminTeachers />} />
            <Route path="institutions" element={<AdminInstitutions />} />
            <Route path="rubrics"   element={<AdminRubrics />} />
            <Route path="feedback"  element={<AdminFeedback />} />
            <Route path="errors"    element={<AdminErrors />} />
          </Route>

          {/* Institution admin — institution_admin or platform_admin */}
          <Route path="/institution" element={<InstitutionRoute><InstitutionLayout /></InstitutionRoute>}>
            <Route index           element={<InstitutionOverview />} />
            <Route path="usage"    element={<InstitutionUsage />} />
            <Route path="teachers" element={<InstitutionTeachers />} />
            <Route path="rubrics"  element={<InstitutionRubrics />} />
            <Route path="audit"    element={<InstitutionAudit />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
