export type RelationType =
  | 'block'
  | 'blockedBy'
  | 'cause'
  | 'causedBy'
  | 'relate'
  | 'duplicate';

export interface GraphWorkItem {
  id: string;
  identifier?: string;
  title?: string;
  type?: string | { id?: string; name?: string };
  state?: {
    id?: string;
    name?: string;
    type?: string;
  };
  project?: {
    id?: string;
    name?: string;
    identifier?: string;
  };
  priority?: {
    id?: string;
    name?: string;
  };
  assignee?: {
    id?: string;
    name?: string;
    display_name?: string;
  };
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  relationType: RelationType;
  label: string;
}

export interface DependencyGraph {
  rootId: string;
  depth: number;
  nodes: GraphWorkItem[];
  edges: GraphEdge[];
  criticalPath: string[];
}

export interface GetDependencyGraphPayload {
  workitemId?: string;
  depth?: number;
  relationTypes?: RelationType[];
}

export const RELATION_OPTIONS: Array<{ value: RelationType; label: string; color: string }> = [
  { value: 'block', label: '阻塞', color: '#d64545' },
  { value: 'blockedBy', label: '被阻塞', color: '#d64545' },
  { value: 'cause', label: '导致', color: '#c47a1a' },
  { value: 'causedBy', label: '由…导致', color: '#c47a1a' },
  { value: 'relate', label: '关联', color: '#3b6fd9' },
  { value: 'duplicate', label: '重复', color: '#6b7280' },
];

export const EDGE_COLORS: Record<string, string> = {
  block: '#d64545',
  cause: '#c47a1a',
  relate: '#3b6fd9',
  duplicate: '#6b7280',
};

export function workItemTypeName(item: GraphWorkItem | null | undefined): string {
  if (!item?.type) {
    return '';
  }
  return typeof item.type === 'string' ? item.type : (item.type.name ?? '');
}

export function workItemAssigneeName(item: GraphWorkItem | null | undefined): string {
  return item?.assignee?.display_name || item?.assignee?.name || '';
}
