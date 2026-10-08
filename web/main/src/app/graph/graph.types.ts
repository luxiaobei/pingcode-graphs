export type GraphNodeKind = 'workitem' | 'more';

export type RelationType = string;

export const KNOWN_RELATION_TYPES = [
  'block',
  'blockedBy',
  'cause',
  'causedBy',
  'relate',
  'duplicate',
] as const;

export type KnownRelationType = (typeof KNOWN_RELATION_TYPES)[number];

/** UI-only; not returned by API. */
export const EXPAND_RELATION_TYPE = 'expand';

export const DEFAULT_EDGE_COLOR = '#94a3b8';

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
  depth?: number;
  kind?: GraphNodeKind;
  hiddenNeighborCount?: number;
  position?: { x: number; y: number };
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

export interface RelationStyle {
  label: string;
  color: string;
  canonical?: string;
}

export const RELATION_STYLE: Record<string, RelationStyle> = {
  block: { label: '阻塞', color: '#d64545' },
  blockedBy: { label: '被阻塞', color: '#d64545', canonical: 'block' },
  cause: { label: '导致', color: '#c47a1a' },
  causedBy: { label: '由…导致', color: '#c47a1a', canonical: 'cause' },
  relate: { label: '关联', color: '#3b6fd9' },
  duplicate: { label: '重复', color: '#6b7280' },
  [EXPAND_RELATION_TYPE]: { label: '展开', color: DEFAULT_EDGE_COLOR },
};

export const RELATION_OPTIONS: Array<{ value: RelationType; label: string; color: string }> =
  KNOWN_RELATION_TYPES.map((value) => ({
    value,
    label: RELATION_STYLE[value].label,
    color: RELATION_STYLE[value].color,
  }));

export function relationColor(type: RelationType): string {
  return RELATION_STYLE[type]?.color ?? DEFAULT_EDGE_COLOR;
}

export function relationLabel(type: RelationType, fallback?: string): string {
  return RELATION_STYLE[type]?.label ?? fallback ?? type;
}

export function toCanonicalType(type: RelationType): string {
  return RELATION_STYLE[type]?.canonical ?? type;
}

export function toCanonicalTypes(types: RelationType[]): Set<string> {
  return new Set(types.map(toCanonicalType));
}

export function workItemTypeName(item: GraphWorkItem | null | undefined): string {
  if (!item?.type) {
    return '';
  }
  return typeof item.type === 'string' ? item.type : (item.type.name ?? '');
}

export function workItemAssigneeName(item: GraphWorkItem | null | undefined): string {
  return item?.assignee?.display_name || item?.assignee?.name || '';
}
