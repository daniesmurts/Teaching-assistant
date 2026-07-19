import client from './client'
import type { Quiz, QuizLevel } from '../types'

export interface GenerateQuizRequest {
  topic:          string
  question_count: number
  course_id?:     string
  level?:         QuizLevel
  source_text?:   string
}

export interface GenerateQuizResponse {
  quiz: Quiz
}

export async function generateQuiz(data: GenerateQuizRequest): Promise<GenerateQuizResponse> {
  const res = await client.post<GenerateQuizResponse>('/api/quizzes/generate', data)
  return res.data
}

export async function getQuizzes(params?: { course_id?: string }): Promise<Quiz[]> {
  const res = await client.get<Quiz[]>('/api/quizzes', { params })
  return res.data
}

export async function getQuiz(id: string): Promise<Quiz> {
  const res = await client.get<Quiz>(`/api/quizzes/${id}`)
  return res.data
}

export async function deleteQuiz(id: string): Promise<void> {
  await client.delete(`/api/quizzes/${id}`)
}
