export type RelationType = string;

/** 默认示例关系；正式数据可由接口配置覆盖 */
export const DEFAULT_RELATION_TYPES = [
  'block',
  'blockedBy',
  'cause',
  'causedBy',
  'relate',
  'relate:work_item',
  'relate:idea',
  'relate:ticket',
  'relate:test_case',
  'relate:objective',
  'duplicate',
  'depend',
  'mention',
  'clone',
  'parent',
  'child',
] as const;
