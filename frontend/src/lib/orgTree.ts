import type { OrgUnit, OrgUnitType } from '../api/orgStructure'

export interface TreeNode extends OrgUnit { children: TreeNode[] }

/** Human-readable label per unit type — shared by the structure tree view
 *  and any other org-unit picker (e.g. the LTI course-mapping modal). */
export const TYPE_LABEL: Record<OrgUnitType, string> = {
  institution:       'Организация',
  governance:        'Руководство',
  admin_office:      'Управление / центр',
  cluster:           'Полигруппа',
  division:          'Институт / факультет',
  ugsn:              'УГСН',
  program_direction: 'Направление подготовки',
  program:           'Образовательная программа',
  department:        'Кафедра',
}

/** Parent-id recursion — shared by InstitutionStructure's tree view and any
 *  other org-unit picker (e.g. the LTI course-mapping modal) so the tree-
 *  construction logic doesn't drift between the two. */
export function buildTree(units: OrgUnit[]): TreeNode[] {
  const byId = new Map<string, TreeNode>()
  units.forEach((u) => byId.set(u.id, { ...u, children: [] }))
  const roots: TreeNode[] = []
  byId.forEach((node) => {
    if (node.parent_id && byId.has(node.parent_id)) byId.get(node.parent_id)!.children.push(node)
    else roots.push(node)
  })
  return roots
}
