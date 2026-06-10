import client from './client'
import type { TopicSet } from '../types'

export interface GenerateTopicsRequest {
  level:         string
  work_type:     string
  field?:        string
  interests?:    string
  practice_site?: string
  student_name?: string
  student_group?: string
  course_id?:    string
  count?:        number
}

export async function generateTopics(data: GenerateTopicsRequest): Promise<TopicSet> {
  return (await client.post<TopicSet>('/api/topics/generate', data)).data
}

export async function getTopicSets(): Promise<TopicSet[]> {
  return (await client.get<TopicSet[]>('/api/topics')).data
}

export async function getTopicSet(id: string): Promise<TopicSet> {
  return (await client.get<TopicSet>(`/api/topics/${id}`)).data
}

export async function deleteTopicSet(id: string): Promise<void> {
  await client.delete(`/api/topics/${id}`)
}
