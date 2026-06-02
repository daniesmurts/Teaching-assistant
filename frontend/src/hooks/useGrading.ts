import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { gradeSubmission, approveGrade, generateEmail, getGradingHistory } from '../api/grading'
import { useUIStore } from '../store/uiStore'
import type { AxiosError } from 'axios'

function errMsg(err: unknown): string {
  const ae = err as AxiosError<{ error: string }>
  return ae.response?.data?.error ?? 'Что-то пошло не так'
}

export function useGrade() {
  const addToast = useUIStore((s) => s.addToast)
  return useMutation({
    mutationFn: gradeSubmission,
    onError: (err) => addToast(errMsg(err), 'error'),
  })
}

export function useApprove() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof approveGrade>[1] }) =>
      approveGrade(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['history'] })
      addToast('Оценка подтверждена', 'success')
    },
    onError: (err) => addToast(errMsg(err), 'error'),
  })
}

export function useGenerateEmail(id: string) {
  const addToast = useUIStore((s) => s.addToast)
  return useMutation({
    mutationFn: (tone?: 'encouraging' | 'neutral' | 'direct') => generateEmail(id, tone),
    onError: (err) => addToast(errMsg(err), 'error'),
  })
}

export function useGradingHistory(params?: { course_id?: string; page?: number }) {
  return useQuery({
    queryKey: ['history', params],
    queryFn: () => getGradingHistory(params),
  })
}
