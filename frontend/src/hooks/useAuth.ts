import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { login, register } from '../api/auth'
import { useAuthStore } from '../store/authStore'

// Errors are surfaced inline on the form (see authErrorMessage + mutation.error),
// so these hooks don't toast — they just handle the success navigation.

// We enter the app via a hard reload (not SPA navigate) so that any Yandex
// Metrica / Webvisor session started on the public login page is torn down
// before authenticated pages (with student PII) render. See lib/metrica.ts.
export function useLogin() {
  const setAuth = useAuthStore((s) => s.setAuth)

  return useMutation({
    mutationFn: login,
    onSuccess: ({ token, teacher, plan }) => {
      setAuth(token, teacher, plan)
      window.location.assign('/dashboard')
    },
  })
}

export function useRegister() {
  const setAuth = useAuthStore((s) => s.setAuth)

  return useMutation({
    mutationFn: register,
    onSuccess: ({ token, teacher, plan }) => {
      setAuth(token, teacher, plan)
      window.location.assign('/dashboard')
    },
  })
}

export function useLogout() {
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const navigate = useNavigate()
  return () => {
    clearAuth()
    navigate('/login')
  }
}
