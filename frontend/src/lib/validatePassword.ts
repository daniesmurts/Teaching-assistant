/**
 * Client-side password rules — must mirror backend authValidation.ts:
 * min 8 chars, at least one uppercase letter, at least one digit.
 * Returns an error message in Russian, or null if valid.
 */
export function validatePassword(password: string): string | null {
  if (password.length < 8) {
    return 'Пароль должен содержать не менее 8 символов'
  }
  if (!/[A-Z]/.test(password)) {
    return 'Пароль должен содержать хотя бы одну заглавную букву'
  }
  if (!/[0-9]/.test(password)) {
    return 'Пароль должен содержать хотя бы одну цифру'
  }
  return null
}
