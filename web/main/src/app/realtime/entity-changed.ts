/** 与后端 src/realtime.ts 中的频道保持一致。 */
export const ENTITY_CHANGED_CHANNEL = 'graphs:entity-changed';

export type EntityChangeAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'link_added'
  | 'link_removed';

export interface EntityChangedPayload {
  action: EntityChangeAction;
  /** 节点 kind：work_item / idea / ticket / test_case / page 等 */
  kind: string;
  /** 原始业务 id */
  refId: string;
  /** 图谱节点 id：{kind}:{refId} */
  nodeId: string;
}
