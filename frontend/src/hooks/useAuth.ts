import { useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { login, register } from '../api/auth'
import { useAuthStore } from '../store/authStore'
import { useUIStore } from '../store/uiStore'
import type { AxiosError } from 'axios'

function errMsg(err: unknown): string {
  const ae = err as AxiosError<{ error: string }>
  return ae.response?.data?.error ?? 'Что-то пошло не так'
}

export function useLogin() {
  const setAuth = useAuthStore((s) => s.setAuth)
  const addToast = useUIStore((s) => s.addToast)
  const navigate = useNavigate()

  return useMutation({
    mutationFn: login,
    onSuccess: ({ token, teacher }) => {
      setAuth(token, teacher)
      navigate('/dashboard')
    },
    onError: (err) => addToast(errMsg(err), 'error'),
  })
}

export function useRegister() {
  const setAuth = useAuthStore((s) => s.setAuth)
  const addToast = useUIStore((s) => s.addToast)
  const navigate = useNavigate()

  return useMutation({
    mutationFn: register,
    onSuccess: ({ token, teacher }) => {
      setAuth(token, teacher)
      navigate('/dashboard')
    },
    onError: (err) => addToast(errMsg(err), 'error'),
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
