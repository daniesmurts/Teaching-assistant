import axios from 'axios'
import { useAuthStore } from '../store/authStore'
import { useUIStore } from '../store/uiStore'

// Per-request opt-out of the global error toast — used by forms that show
// the error inline instead (login, register, password reset, account delete).
declare module 'axios' {
  export interface AxiosRequestConfig {
    skipErrorToast?: boolean
  }
}

const client = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '',
  timeout: 60_000, // AI calls can be slow
})

// Attach JWT to every request
client.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Central error handling
client.interceptors.response.use(
  (res) => res,
  (err) => {
    const status  = err.response?.status
    const code    = err.response?.data?.code    as string | undefined
    const message = err.response?.data?.error   as string | undefined
    const upgrade = err.response?.data?.upgrade as boolean | undefined

    // Session expired → clear auth and redirect to login
    if (status === 401) {
      useAuthStore.getState().clearAuth()
      window.location.href = '/login'
      return Promise.reject(err)
    }

    // Plan limit or feature gate → show upgrade modal
    if (upgrade) {
      useUIStore.getState().showUpgradeModal(code)
      return Promise.reject(err)
    }

    // Forms that render the error inline opt out of the global toast
    if (err.config?.skipErrorToast) {
      return Promise.reject(err)
    }

    // All other errors → show toast
    const userMessage =
      message ??
      ERROR_MESSAGES[code ?? ''] ??
      'Что-то пошло не так. Пожалуйста, попробуйте ещё раз.'

    useUIStore.getState().addToast(userMessage, 'error')
    return Promise.reject(err)
  }
)

const ERROR_MESSAGES: Record<string, string> = {
  VALIDATION_ERROR:          'Проверьте введённые данные и попробуйте снова.',
  NOT_FOUND:                 'Запрошенный объект не найден.',
  FORBIDDEN:                 'Недостаточно прав для выполнения этого действия.',
  AI_SERVICE_ERROR:          'Сервис ИИ временно недоступен. Попробуйте через несколько секунд.',
  DOCUMENT_PROCESSING_ERROR: 'Не удалось обработать документ. Проверьте файл и попробуйте снова.',
  INTERNAL_ERROR:            'Непредвиденная ошибка. Если она повторяется, свяжитесь с поддержкой.',
  AI_RATE_LIMITED:           'Слишком много запросов к ИИ. Подождите минуту и попробуйте снова.',
  RATE_LIMITED:              'Слишком много запросов. Пожалуйста, подождите.',
}

export default client
