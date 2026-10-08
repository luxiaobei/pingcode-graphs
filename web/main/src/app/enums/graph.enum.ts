export const GraphNodeKind = {
  Workitem: 'workitem',
  More: 'more',
} as const;

export type GraphNodeKind = (typeof GraphNodeKind)[keyof typeof GraphNodeKind];

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
