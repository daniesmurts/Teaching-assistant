import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { login, register } from '../api/auth'
import { useAuthStore } from '../store/authStore'

// Errors are surfaced inline on the form (see authErrorMessage + mutation.error),
// so these hooks don't toast — they just handle the success navigation.

export function useLogin() {
  const setAuth = useAuthStore((s) => s.setAuth)
  const navigate = useNavigate()

  return useMutation({
    mutationFn: login,
    onSuccess: ({ token, teacher, plan }) => {
      setAuth(token, teacher, plan)
      navigate('/dashboard')
    },
  })
}

export function useRegister() {
  const setAuth = useAuthStore((s) => s.setAuth)
  const navigate = useNavigate()

  return useMutation({
    mutationFn: register,
    onSuccess: ({ token, teacher, plan }) => {
      setAuth(token, teacher, plan)
      navigate('/dashboard')
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
