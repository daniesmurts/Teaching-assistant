import { describe, it, expect, afterEach, vi } from 'vitest'
import { getApiBaseUrl } from './runtimeConfig'

describe('getApiBaseUrl', () => {
  afterEach(() => {
    delete window.__ISPUM_CONFIG__
    vi.unstubAllEnvs()
  })

  it('falls back to same-origin ("") when nothing is configured', () => {
    vi.stubEnv('VITE_API_BASE_URL', '')
    expect(getApiBaseUrl()).toBe('')
  })

  it('falls through an unedited default config.js (empty string) to VITE_API_BASE_URL', () => {
    window.__ISPUM_CONFIG__ = { apiBaseUrl: '' }
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000')
    expect(getApiBaseUrl()).toBe('http://localhost:3000')
  })

  it('a real runtime config value wins over VITE_API_BASE_URL', () => {
    window.__ISPUM_CONFIG__ = { apiBaseUrl: 'https://api.ispum.university.ru' }
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000')
    expect(getApiBaseUrl()).toBe('https://api.ispum.university.ru')
  })

  it('no window.__ISPUM_CONFIG__ at all falls through to VITE_API_BASE_URL', () => {
    delete window.__ISPUM_CONFIG__
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:3000')
    expect(getApiBaseUrl()).toBe('http://localhost:3000')
  })
})
