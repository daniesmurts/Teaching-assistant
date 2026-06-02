import axios from 'axios'
import { useAuthStore } from '../store/authStore'

const client = axios.create({
  // Vite proxies /api → localhost:3000 in dev; in prod set VITE_API_BASE_URL
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '',
})

client.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

client.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) useAuthStore.getState().clearAuth()
    return Promise.reject(err)
  }
)

export default client
