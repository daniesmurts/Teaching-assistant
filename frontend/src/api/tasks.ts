import client from './client'
import type { TaskSet, MaterialKind } from '../types'

export interface GenerateTasksRequest {
  kind:       MaterialKind
  topic:      string
  difficulty: string
  course_id?: string
  count?:     number
}

export async function generateTasks(data: GenerateTasksRequest): Promise<TaskSet> {
  return (await client.post<TaskSet>('/api/tasks/generate', data)).data
}

export async function getTaskSets(kind?: MaterialKind): Promise<TaskSet[]> {
  return (await client.get<TaskSet[]>('/api/tasks', { params: kind ? { kind } : undefined })).data
}

export async function deleteTaskSet(id: string): Promise<void> {
  await client.delete(`/api/tasks/${id}`)
}
