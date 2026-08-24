import axios from 'axios'
import { useAuthStore } from '../store/authStore'
import { useUIStore } from '../store/uiStore'
import { getApiBaseUrl } from '../lib/runtimeConfig'

// Per-request opt-out of the global error toast — used by forms that show
// the error inline instead (login, register, password reset, account delete).
declare module 'axios' {
  export interface AxiosRequestConfig {
    skipErrorToast?: boolean
  }
}

const client = axios.create({
  baseURL: getApiBaseUrl(),
  timeout: 120_000, // AI calls can be slow — the reasoning model (calc grading) especially
  // Session lives in an HttpOnly cookie now (not a header we attach) — the
  // browser only sends it cross-origin if the request opts in.
  withCredentials: true,
  headers: {
    // Defense-in-depth CSRF check the backend requires on mutating requests
    // (see middleware/authenticate.ts) — a plain cross-site <form> POST can't
    // set a custom header, and a fetch/XHR from an origin outside our CORS
    // allow-list can't get this past preflight either.
    'X-Requested-With': 'ISPUM',
  },
})

// Pull a *string* error message out of whatever the server (or an upstream
// proxy) sent back. Reasons the field might not be a string:
//   - express-validator failures sometimes attach an array/object payload
//   - a non-ours-Express layer (502 from nginx, an interloper static server
//     on the API port, etc.) returns raw HTML or a nested `{code, message}`
//   - a future backend rewrite changes the contract
// In any of those cases we'd rather fall through to the friendly Russian
// fallback than crash <ToastContainer> with "Objects are not valid as a
// React child".
function extractErrorMessage(err: unknown): string | undefined {
  const data = (err as { response?: { data?: unknown } })?.response?.data as Record<string, unknown> | undefined
  const raw  = data?.error
  return typeof raw === 'string' ? raw : undefined
}

function extractErrorCode(err: unknown): string | undefined {
  const data = (err as { response?: { data?: unknown } })?.response?.data as Record<string, unknown> | undefined
  const raw  = data?.code
  return typeof raw === 'string' ? raw : undefined
}

// Central error handling
client.interceptors.response.use(
  (res) => res,
  (err) => {
    const status  = err.response?.status
    const code    = extractErrorCode(err)
    const message = extractErrorMessage(err)
    const upgrade = err.response?.data?.upgrade === true

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
  AI_SERVICE_ERROR:          'Сервис проверки временно недоступен. Попробуйте через несколько секунд.',
  DOCUMENT_PROCESSING_ERROR: 'Не удалось обработать документ. Проверьте файл и попробуйте снова.',
  INTERNAL_ERROR:            'Непредвиденная ошибка. Если она повторяется, свяжитесь с поддержкой.',
  AI_RATE_LIMITED:           'Слишком много запросов на проверку. Подождите минуту и попробуйте снова.',
  RATE_LIMITED:              'Слишком много запросов. Пожалуйста, подождите.',
}

export default client
