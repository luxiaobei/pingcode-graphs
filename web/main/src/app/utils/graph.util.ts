import { NavigationTarget } from '@pc-nexus/bridge';
import {
  CRITICAL_PATH_RELATION_TYPES,
  DEFAULT_EDGE_COLOR,
  RELATION_STYLE,
} from '../constants/graph.constants';
import type { GraphEntity } from '../entities/graph.entity';
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

export function isCriticalRelation(type: RelationType): boolean {
  return CRITICAL_PATH_RELATION_TYPES.includes(toCanonicalType(type));
}

export function entityTypeName(item: GraphEntity | null | undefined): string {
  if (!item?.type) {
    return '';
  }
  return typeof item.type === 'string' ? item.type : (item.type.name ?? '');
}

export function entityAssigneeName(item: GraphEntity | null | undefined): string {
  return item?.assignee?.display_name || item?.assignee?.name || '';
}

export function entityScopeName(item: GraphEntity | null | undefined): string {
  return item?.scope?.name || '';
}

/** 使用服务端下发的 navigationTarget；无效时不打开 */
export function resolveNavigationTarget(item: GraphEntity): NavigationTarget | null {
  const target = item.navigationTarget as NavigationTarget | undefined;
  if (target && Object.values(NavigationTarget).includes(target)) {
    return target;
  }
  return null;
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max - 1)}…`;
}
