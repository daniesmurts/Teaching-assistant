import axios from 'axios'
import { AppError } from '../errors/AppError'
import { TruncatedResponseError, InvalidModelJsonError } from '../services/llm/modelJson'

// Turning an exception into something a teacher can act on.
//
// Async jobs store their failure in a column the UI prints verbatim
// (`presentation_jobs.error_message` → PresentationForm's red line). Until
// now that column held `(err as Error).message`, so on 2026-09-09 a teacher
// pressing «Построить план лекции» was shown
//
//   Expected ',' or ']' after array element in JSON at position 3203
//
// — a V8 parser message, in English, naming an offset in a buffer she has
// never seen. The raw text still goes to the logs and to
// production_incidents, where it belongs; this is what goes on the screen.
//
// Every branch says what happened AND what to do about it. "Попробуйте ещё
// раз" alone is only honest when a retry is genuinely likely to work, which
// is why truncation — where an identical retry fails identically — tells the
// teacher to shorten the request instead.

export function userFacingFailure(err: unknown, fallback: string): string {
  // AppError messages are written for users already (ValidationError,
  // NotFoundError, plan-limit errors) — passing them through is the point of
  // having them in Russian in the first place.
  if (err instanceof AppError) return err.message

  if (err instanceof TruncatedResponseError) {
    return 'Ответ модели не поместился в лимит и оборвался. Попробуйте уменьшить число слайдов ' +
           'или сократить конспект — и запустите снова.'
  }

  if (err instanceof InvalidModelJsonError) {
    return 'Модель вернула ответ в неожиданном формате. Попробуйте запустить ещё раз.'
  }

  if (err instanceof SyntaxError) {
    // A JSON.parse escaping some path that does not go through modelJson.ts.
    // The wording matches InvalidModelJsonError deliberately: to the teacher
    // it is the same event, and which internal layer noticed is our problem.
    return 'Модель вернула ответ в неожиданном формате. Попробуйте запустить ещё раз.'
  }

  if (axios.isAxiosError(err)) {
    const status = err.response?.status
    if (status === 429) return 'Сервис перегружен. Подождите минуту и попробуйте снова.'
    if (status && status >= 500) return 'Сервис генерации временно недоступен. Попробуйте через несколько минут.'
    if (!err.response) return 'Не удалось связаться с сервисом генерации. Проверьте соединение и попробуйте снова.'
  }

  return fallback
}
