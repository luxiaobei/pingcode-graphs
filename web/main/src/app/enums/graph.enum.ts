export type RelationType = string;

/** 默认示例关系；正式数据可由接口配置覆盖 */
export const DEFAULT_RELATION_TYPES = [
  'block',
  'blockedBy',
  'cause',
  'causedBy',
  'relate',
  'duplicate',
  'depend',
  'mention',
  'clone',
  'child',
] as const;
