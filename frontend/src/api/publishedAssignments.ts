import client from './client'
import type { ProvenanceFacts } from '../types'

export type PublishedStatus = 'draft' | 'open' | 'closed'
export type InviteStatus    = 'invited' | 'writing' | 'submitted'

export interface PublishedAssignment {
  id:           string
  teacher_id:   string
  course_id:    string | null
  rubric_id:    string | null
  title:        string
  instructions: string | null
  due_at:       string | null
  status:       PublishedStatus
  published_at: string | null
  created_at:   string
}

export interface PublishedAssignmentWithCounts extends PublishedAssignment {
  invite_count:    number
  submitted_count: number
}

export interface AssignmentInvite {
  id:                      string
  published_assignment_id: string
  student_name:            string | null
  student_email:           string | null
  token:                   string
  status:                  InviteStatus
  submitted_at:            string | null
  created_at:              string
}

export async function listPublishedAssignments(): Promise<PublishedAssignmentWithCounts[]> {
  return (await client.get<{ assignments: PublishedAssignmentWithCounts[] }>('/api/published-assignments')).data.assignments
}

export async function createPublishedAssignment(input: {
  title: string; instructions?: string | null; course_id?: string | null; rubric_id?: string | null; due_at?: string | null
}): Promise<PublishedAssignment> {
  return (await client.post<PublishedAssignment>('/api/published-assignments', input)).data
}

export async function getPublishedAssignment(id: string): Promise<{ assignment: PublishedAssignment; invites: AssignmentInvite[] }> {
  return (await client.get<{ assignment: PublishedAssignment; invites: AssignmentInvite[] }>(`/api/published-assignments/${id}`)).data
}

export async function updatePublishedAssignment(
  id: string,
  patch: { title?: string; instructions?: string | null; due_at?: string | null; status?: PublishedStatus }
): Promise<PublishedAssignment> {
  return (await client.patch<PublishedAssignment>(`/api/published-assignments/${id}`, patch)).data
}

export async function addInvite(
  id: string,
  input: { student_name?: string | null; student_email?: string | null }
): Promise<AssignmentInvite> {
  return (await client.post<AssignmentInvite>(`/api/published-assignments/${id}/invites`, input)).data
}

export async function deleteInvite(id: string, inviteId: string): Promise<void> {
  await client.delete(`/api/published-assignments/${id}/invites/${inviteId}`, { skipErrorToast: true })
}

export interface SubmissionReview {
  student_name:    string | null
  student_email:   string | null
  submitted_at:    string | null
  submission_text: string
  provenance:      ProvenanceFacts
}

export async function getSubmission(id: string, inviteId: string): Promise<SubmissionReview> {
  return (await client.get<SubmissionReview>(`/api/published-assignments/${id}/submissions/${inviteId}`)).data
}

/** The student writing-surface URL for an invite token (the link to share). */
export function writeUrl(token: string): string {
  return `${window.location.origin}/write/${token}`
}
