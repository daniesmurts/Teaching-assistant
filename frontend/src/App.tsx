import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
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
import Presentations from './pages/Presentations'
import Billing from './pages/Billing'
import Settings from './pages/Settings'
import Help from './pages/Help'
import AdminLayout from './pages/admin/AdminLayout'
import AdminOverview from './pages/admin/AdminOverview'
import AdminUsage from './pages/admin/AdminUsage'
import AdminTeachers from './pages/admin/AdminTeachers'
import AdminRubrics from './pages/admin/AdminRubrics'
import AdminErrors from './pages/admin/AdminErrors'
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

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
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
            <Route path="/presentations" element={<Presentations />} />
            <Route path="/billing"       element={<Billing />} />
            <Route path="/settings"      element={<Settings />} />
            <Route path="/help"          element={<Help />} />
          </Route>
          {/* Admin — platform_admin only, own layout, direct URL access */}
          <Route path="/admin" element={<AdminRoute><AdminLayout /></AdminRoute>}>
            <Route index            element={<AdminOverview />} />
            <Route path="usage"     element={<AdminUsage />} />
            <Route path="teachers"  element={<AdminTeachers />} />
            <Route path="rubrics"   element={<AdminRubrics />} />
            <Route path="errors"    element={<AdminErrors />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
