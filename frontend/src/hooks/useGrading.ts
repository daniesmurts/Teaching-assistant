import { useMutation, useQueryClient } from '@tanstack/react-query'
import { approveGrade, generateEmail } from '../api/grading'
import { checkSatisfactionPrompt } from '../api/satisfaction'
import { useUIStore } from '../store/uiStore'
import type { AxiosError } from 'axios'

function errMsg(err: unknown): string {
  const ae = err as AxiosError<{ error: string }>
  return ae.response?.data?.error ?? 'Что-то пошло не так'
}

export function useApprove() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const showSatisfaction = useUIStore((s) => s.showSatisfaction)
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof approveGrade>[1] }) =>
      approveGrade(id, data),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['history'] })
      addToast('Оценка подтверждена', 'success')

      // Micro-satisfaction prompt (TODO Feature SAT). Fires on APPROVE, never
      // on the grade itself: asking "was this good?" before the teacher has
      // reviewed it would nudge a rubber-stamp, and the whole product rests on
      // the review being real. The server decides whether to actually ask —
      // see services/satisfaction.ts for the cooldowns. Never awaited and
      // never surfaces an error: a survey must not be able to spoil the
      // action it is asking about.
      checkSatisfactionPrompt('grading', vars.id, { edited: Boolean(vars.data.approved_edit_reason) })
        .then((promptId) => {
          if (promptId) showSatisfaction(promptId, {
            question: 'Насколько пришлось переписывать оценку?',
            labels:   ['Почти всю', 'Частично', 'Почти не пришлось'],
          })
        })
        .catch(() => null)
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
