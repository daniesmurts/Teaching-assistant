import client from './client'
import type { DocumentVisibilityScope, DocumentProvenance, LibraryDocumentEntry } from '../types'

// Feature AN — Кафедральная библиотека (TODO.md "### AN")

export async function getLibrary(): Promise<LibraryDocumentEntry[]> {
  return (await client.get<LibraryDocumentEntry[]>('/api/institution/library')).data
}

export interface PromoteDocumentScopePayload {
  visibility_scope: DocumentVisibilityScope   // 'course' | 'unit' | 'institution' — never 'platform' (curated-only)
  scope_unit_id?:   string
  provenance?:      DocumentProvenance        // required unless demoting back to 'course'
}

export interface PromoteDocumentScopeResult {
  id:               string
  visibilityScope:  DocumentVisibilityScope
  scopeUnitId:      string | null
  provenance:       DocumentProvenance
}

export async function getDocumentReuseCount(documentId: string): Promise<number> {
  return (await client.get<{ reuseCount: number }>(`/api/documents/${documentId}/reuse`)).data.reuseCount
}

export async function promoteDocumentScope(
  documentId: string,
  payload: PromoteDocumentScopePayload
): Promise<PromoteDocumentScopeResult> {
  return (await client.patch<PromoteDocumentScopeResult>(`/api/documents/${documentId}/scope`, payload)).data
}
