export const GraphNodeKind = {
  Entity: 'entity',
  More: 'more',
} as const;

export type GraphNodeKind = (typeof GraphNodeKind)[keyof typeof GraphNodeKind];

export type RelationType = string;

/** 默认示例关系；正式数据由接口下发覆盖 */
export const DEFAULT_RELATION_TYPES = [
  'block',
  'blockedBy',
  'cause',
  'causedBy',
  'relate',
  'duplicate',
] as const;

export type DefaultRelationType = (typeof DEFAULT_RELATION_TYPES)[number];

/** UI-only; not returned by API. */
export const EXPAND_RELATION_TYPE = 'expand';
