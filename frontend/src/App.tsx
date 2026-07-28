import { Suspense, lazy, useEffect, useRef } from 'react'
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
import SsoCallback from './pages/SsoCallback'
import LtiCallback from './pages/LtiCallback'
import LtiDeepLink from './pages/LtiDeepLink'
import PaymentResult from './pages/PaymentResult'
import Dashboard from './pages/Dashboard'
import Courses from './pages/Courses'
import Grading from './pages/Grading'
import Criteria from './pages/Criteria'
import Rubrics from './pages/Rubrics'
import LearningLoop from './pages/LearningLoop'
import FeedbackLibrary from './pages/FeedbackLibrary'
import Students from './pages/Students'
import History from './pages/History'
import Presentations from './pages/Presentations'
import Topics from './pages/Topics'
import Curriculum from './pages/Curriculum'
import RopStudio from './pages/RopStudio'
import MySyllabi from './pages/MySyllabi'
import Quizzes from './pages/Quizzes'
import FosStudio from './pages/FosStudio'
import BrsStudio from './pages/BrsStudio'
import PublishedAssignments from './pages/PublishedAssignments'
import PublishedAssignmentDetail from './pages/PublishedAssignmentDetail'
import SubmissionReview from './pages/SubmissionReview'
import StudentWrite from './pages/StudentWrite'
import LiveSessionHost from './pages/LiveSessionHost'
import LiveJoin from './pages/LiveJoin'
import MaterialGenerator from './pages/MaterialGenerator'
import Materials from './pages/Materials'
import Billing from './pages/Billing'
import Settings from './pages/Settings'
import Leadership from './pages/Leadership'
import LeadershipTeacher from './pages/LeadershipTeacher'
import Help from './pages/Help'
import Feedback from './pages/Feedback'
import AdminLayout from './pages/admin/AdminLayout'
import AdminOverview from './pages/admin/AdminOverview'
import AdminUsage from './pages/admin/AdminUsage'
import AdminActivation from './pages/admin/AdminActivation'
import AdminPayments from './pages/admin/AdminPayments'
import AdminTeachers from './pages/admin/AdminTeachers'
import AdminRubrics from './pages/admin/AdminRubrics'
import AdminRubricTemplates from './pages/admin/AdminRubricTemplates'
import AdminInstitutions from './pages/admin/AdminInstitutions'
import AdminFeedback from './pages/admin/AdminFeedback'
import AdminMessages from './pages/admin/AdminMessages'
import AdminErrors from './pages/admin/AdminErrors'
import AdminAudit from './pages/admin/AdminAudit'
import AdminEvals from './pages/admin/AdminEvals'
import AdminFgos from './pages/admin/AdminFgos'
import InstitutionLayout from './pages/institution/InstitutionLayout'
import InstitutionOverview from './pages/institution/InstitutionOverview'
import InstitutionUsage from './pages/institution/InstitutionUsage'
import InstitutionTeachers from './pages/institution/InstitutionTeachers'
import InstitutionRubrics from './pages/institution/InstitutionRubrics'
import InstitutionRubricPresets from './pages/institution/InstitutionRubricPresets'
import InstitutionSharedRag from './pages/institution/InstitutionSharedRag'
import InstitutionStrategyDocument from './pages/institution/InstitutionStrategyDocument'
import InstitutionModel from './pages/institution/InstitutionModel'
import InstitutionLti from './pages/institution/InstitutionLti'
import InstitutionAudit from './pages/institution/InstitutionAudit'
import InstitutionPrograms from './pages/institution/InstitutionPrograms'
import InstitutionProgramDetail from './pages/institution/InstitutionProgramDetail'
import InstitutionStructure from './pages/institution/InstitutionStructure'
import RpdMonitor from './pages/institution/RpdMonitor'
import UmcDashboard from './pages/institution/UmcDashboard'
import RpdApprovals from './pages/institution/RpdApprovals'
import NewVersionToast from './components/NewVersionToast'
import LoadingSpinner from './components/ui/LoadingSpinner'

// Public marketing + legal pages, lazy-loaded — a logged-in teacher's session
// lives entirely inside AppShell's routes and never needs this bundle; a
// logged-out visitor never needs the ~70-route authenticated app. Splitting
// keeps both sides of the audience from paying for the other's code.
const Landing    = lazy(() => import('./pages/Landing'))
const About      = lazy(() => import('./pages/About'))
const Institutions = lazy(() => import('./pages/Institutions'))
const Research   = lazy(() => import('./pages/Research'))
const FAQ        = lazy(() => import('./pages/FAQ'))
const Ethics     = lazy(() => import('./pages/Ethics'))
const Contact    = lazy(() => import('./pages/Contact'))
const Unsubscribe = lazy(() => import('./pages/Unsubscribe'))
const Pricing    = lazy(() => import('./pages/Pricing'))
const Changelog  = lazy(() => import('./pages/Changelog'))
const UseCases   = lazy(() => import('./pages/UseCases'))
const LegalIndex  = lazy(() => import('./pages/legal/LegalIndex'))
const AcceptableUse = lazy(() => import('./pages/legal/AcceptableUse'))
const Offer      = lazy(() => import('./pages/legal/Offer'))
const Privacy    = lazy(() => import('./pages/legal/Privacy'))
const Terms      = lazy(() => import('./pages/legal/Terms'))
const Cookies    = lazy(() => import('./pages/legal/Cookies'))

function PageLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <LoadingSpinner size={24} />
    </div>
  )
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
})

// Drive Yandex Metrica for logged-out visitors on public pages only.
// Authenticated pages show student PII, so we never init the counter there
// (and a hard reload on login tears down any replay session — see useAuth.ts).
// initMetrica() counts the first view itself, so the initial mount skips the hit.
function RouteTracker() {
  const location = useLocation()
  const authenticated = useAuthStore((s) => s.authenticated)
  const first = useRef(true)
  useEffect(() => {
    if (authenticated || !isPublicPath(location.pathname)) return
    initMetrica()
    if (first.current) { first.current = false; return }
    metricaHit(window.location.href)
  }, [location, authenticated])
  return null
}

// React Router doesn't scroll to `#anchor` targets on client-side navigation
// (only the browser's native full-page load does). Deep links like
// /offer#payment need this to actually land on the section.
function ScrollToHash() {
  const { hash, pathname } = useLocation()
  useEffect(() => {
    if (!hash) return
    const el = document.getElementById(hash.slice(1))
    el?.scrollIntoView({ block: 'start' })
  }, [hash, pathname])
  return null
}

// Reconcile the cached teacher + plan with the server. The plan is persisted
// in localStorage, so an upgrade confirmed elsewhere (admin panel, T-Bank
// webhook) wouldn't otherwise reach the browser without a re-login. We refresh:
//   - on mount / token change (login, reload)
//   - when the tab regains focus or becomes visible (so a mid-session upgrade —
//     e.g. the user paid in another tab, or an admin upgraded them — shows up
//     within a moment, no logout needed)
// Silent + non-blocking; a 401 is handled by the axios client.
function PlanSync() {
  const authenticated = useAuthStore((s) => s.authenticated)
  const updateAccount = useAuthStore((s) => s.updateAccount)

  useEffect(() => {
    if (!authenticated) return

    let last = 0
    const refresh = () => {
      // Throttle: focus + visibilitychange can both fire on a single tab switch.
      const now = Date.now()
      if (now - last < 3000) return
      last = now
      getMe()
        .then(({ teacher, plan }) => updateAccount(teacher, plan))
        .catch(() => { /* non-fatal — keep cached values */ })
    }

    refresh()   // initial reconcile

    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [authenticated, updateAccount])
  return null
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const authenticated = useAuthStore((s) => s.authenticated)
  return authenticated ? <>{children}</> : <Navigate to="/login" replace />
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const teacher = useAuthStore((s) => s.teacher)
  if (!teacher) return <Navigate to="/login" replace />
  // Org-tree-derived (§7). Falls back to the legacy enum for sessions stored
  // before the flag was added — refreshed on next /me.
  const isPlatformAdmin = teacher.is_platform_admin ?? teacher.role === 'platform_admin'
  if (!isPlatformAdmin) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

function InstitutionRoute({ children }: { children: React.ReactNode }) {
  const teacher = useAuthStore((s) => s.teacher)
  if (!teacher) return <Navigate to="/login" replace />
  const canAdmin =
    (teacher.is_platform_admin ?? teacher.role === 'platform_admin') ||
    (teacher.is_institution_admin ?? teacher.role === 'institution_admin') ||
    // docs/ACCESS-MATRIX.md — a criteria-, org-overview-, platform-, or umu-
    // access grant (e.g. a ЗК/ДИ, ПР УР, subtree-scoped institute director,
    // or УМЦ head) reaches this panel too, without being an institution-root
    // admin. InstitutionLayout filters the NAV to what the grant actually
    // covers. `criteria_access`/`org_overview_access`, NOT plain
    // `curriculum_access`/`teaching_access` — no NAV item is gated on those
    // broad domains anymore, so a РОП/РПГ/УМУ/РУМЦ/МУМЦ holding only those
    // would land on an empty panel.
    (!!teacher.criteria_access && teacher.criteria_access !== 'none') ||
    (!!teacher.org_overview_access && teacher.org_overview_access !== 'none') ||
    (!!teacher.platform_access && teacher.platform_access !== 'none') ||
    (!!teacher.umu_access && teacher.umu_access !== 'none')
  if (!canAdmin) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

// «Руководство» — visible to any head/admin on a unit (or platform admin).
// is_leader is derived server-side; falls back to the institution-admin signal
// for sessions stored before the flag was added.
function LeadershipRoute({ children }: { children: React.ReactNode }) {
  const teacher = useAuthStore((s) => s.teacher)
  if (!teacher) return <Navigate to="/login" replace />
  const isLeader =
    (teacher.is_leader ?? false) ||
    (teacher.is_platform_admin ?? teacher.role === 'platform_admin') ||
    (teacher.is_institution_admin ?? teacher.role === 'institution_admin')
  if (!isLeader) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

// «Образовательные программы» — visible to anyone with program_access !== 'none'
// (РОП, начальник УМЦ, проректор, институция-админ, платформ-админ). Server
// resolves the actual scope; this gate is just the visibility signal.
function ProgramsRoute({ children }: { children: React.ReactNode }) {
  const teacher = useAuthStore((s) => s.teacher)
  if (!teacher) return <Navigate to="/login" replace />
  const canSee =
    (teacher.program_access && teacher.program_access !== 'none') ||
    (teacher.is_platform_admin ?? teacher.role === 'platform_admin') ||
    (teacher.is_institution_admin ?? teacher.role === 'institution_admin')
  if (!canSee) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <PlanSync />
        <RouteTracker />
        <ScrollToHash />
        <NewVersionToast />
        <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/"         element={<Landing />} />
          <Route path="/about"    element={<About />} />
          <Route path="/institutions" element={<Institutions />} />
          <Route path="/research"     element={<Research />} />
          <Route path="/faq"      element={<FAQ />} />
          <Route path="/ethics"   element={<Ethics />} />
          <Route path="/contact"  element={<Contact />} />
          <Route path="/unsubscribe" element={<Unsubscribe />} />
          <Route path="/pricing"  element={<Pricing />} />
          <Route path="/changelog" element={<Changelog />} />
          <Route path="/use-cases" element={<UseCases />} />
          <Route path="/legal"    element={<LegalIndex />} />
          <Route path="/acceptable-use" element={<AcceptableUse />} />
          <Route path="/offer"    element={<Offer />} />
          <Route path="/privacy"  element={<Privacy />} />
          <Route path="/terms"    element={<Terms />} />
          <Route path="/cookies"  element={<Cookies />} />
          <Route path="/login"            element={<Login />} />
          <Route path="/register"         element={<Register />} />
          <Route path="/forgot-password"  element={<ForgotPassword />} />
          <Route path="/reset-password"   element={<ResetPassword />} />
          <Route path="/sso/callback"     element={<SsoCallback />} />
          <Route path="/lti/callback"     element={<LtiCallback />} />
          <Route path="/lti/deep-link"    element={<LtiDeepLink />} />
          <Route path="/write/:token"     element={<StudentWrite />} />
          <Route path="/live/:code"       element={<LiveJoin />} />
          <Route path="/live/host/:sessionId" element={<ProtectedRoute><LiveSessionHost /></ProtectedRoute>} />
          <Route path="/payment/result"   element={<PaymentResult />} />
          <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
            <Route path="/dashboard"     element={<Dashboard />} />
            <Route path="/courses"       element={<Courses />} />
            <Route path="/grading"       element={<Grading />} />
            <Route path="/published"     element={<PublishedAssignments />} />
            <Route path="/published/:id" element={<PublishedAssignmentDetail />} />
            <Route path="/published/:id/submissions/:inviteId" element={<SubmissionReview />} />
            <Route path="/criteria"      element={<Criteria />} />
            <Route path="/rubrics"       element={<Rubrics />} />
            <Route path="/learning-loop" element={<LearningLoop />} />
            <Route path="/library"       element={<FeedbackLibrary />} />
            <Route path="/students"      element={<Students />} />
            <Route path="/history"       element={<History />} />
            <Route path="/materials"     element={<Materials />} />
            <Route path="/presentations" element={<Presentations />} />
            <Route path="/topics"        element={<Topics />} />
            <Route path="/curriculum"    element={<Curriculum />} />
            <Route path="/my-syllabi"    element={<MySyllabi />} />
            <Route path="/quizzes"       element={<Quizzes />} />
            <Route path="/fos"          element={<FosStudio />} />
            <Route path="/brs"          element={<BrsStudio />} />
            <Route path="/materials/:kind" element={<MaterialGenerator />} />
            <Route path="/billing"       element={<Billing />} />
            <Route path="/leadership"              element={<LeadershipRoute><Leadership /></LeadershipRoute>} />
            <Route path="/leadership/teachers/:id" element={<LeadershipRoute><LeadershipTeacher /></LeadershipRoute>} />
            <Route path="/programs"      element={<ProgramsRoute><InstitutionPrograms /></ProgramsRoute>} />
            <Route path="/programs/:id"  element={<ProgramsRoute><InstitutionProgramDetail /></ProgramsRoute>} />
            <Route path="/rop-studio"    element={<ProgramsRoute><RopStudio /></ProgramsRoute>} />
            <Route path="/settings"      element={<Settings />} />
            <Route path="/help"          element={<Help />} />
            <Route path="/feedback"      element={<Feedback />} />
          </Route>
          {/* Admin — platform_admin only, own layout, direct URL access */}
          <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
            <Route index            element={<AdminOverview />} />
            <Route path="usage"     element={<AdminUsage />} />
            <Route path="activation" element={<AdminActivation />} />
            <Route path="payments"  element={<AdminPayments />} />
            <Route path="teachers"  element={<AdminTeachers />} />
            <Route path="institutions" element={<AdminInstitutions />} />
            <Route path="rubrics"   element={<AdminRubrics />} />
            <Route path="rubric-templates" element={<AdminRubricTemplates />} />
            <Route path="feedback"  element={<AdminFeedback />} />
            <Route path="messages"  element={<AdminMessages />} />
            <Route path="errors"    element={<AdminErrors />} />
            <Route path="audit"     element={<AdminAudit />} />
            <Route path="evals"     element={<AdminEvals />} />
            <Route path="fgos"      element={<AdminFgos />} />
          </Route>

          {/* Institution admin — institution_admin or platform_admin */}
          <Route path="/institution" element={<InstitutionRoute><InstitutionLayout /></InstitutionRoute>}>
            <Route index           element={<InstitutionOverview />} />
            <Route path="structure" element={<InstitutionStructure />} />
            <Route path="rpd"       element={<RpdMonitor />} />
            <Route path="umc"       element={<UmcDashboard />} />
            <Route path="rpd-approvals" element={<RpdApprovals />} />
            <Route path="usage"    element={<InstitutionUsage />} />
            <Route path="teachers" element={<InstitutionTeachers />} />
            <Route path="rubrics"  element={<InstitutionRubrics />} />
            <Route path="rubric-presets" element={<InstitutionRubricPresets />} />
            <Route path="programs"        element={<InstitutionPrograms />} />
            <Route path="programs/:id"    element={<InstitutionProgramDetail />} />
            <Route path="shared-rag"   element={<InstitutionSharedRag />} />
            <Route path="strategy-document" element={<InstitutionStrategyDocument />} />
            <Route path="model"        element={<InstitutionModel />} />
            <Route path="lti"          element={<InstitutionLti />} />
            <Route path="audit"    element={<InstitutionAudit />} />
          </Route>
        </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
