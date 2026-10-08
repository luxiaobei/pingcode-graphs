import { DEFAULT_EDGE_COLOR, RELATION_STYLE } from '../constants/graph.constants';
import type { GraphWorkItem } from '../entities/graph.entity';
import type { RelationType } from '../enums/graph.enum';

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

export function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}
