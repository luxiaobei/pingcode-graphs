import { realtime } from "@pc-nexus/realtime";
import { kgNodeId, type KgNodeKind } from "./models/pc-kg-node.js";

/** 图谱实体变更频道：前端通过 bridge.realtime 订阅后刷新关系图。 */
export const ENTITY_CHANGED_CHANNEL = "graphs:entity-changed";

export type EntityChangeAction = "created" | "updated" | "deleted" | "link_added" | "link_removed";

export interface EntityChangedPayload {
    action: EntityChangeAction;
    /** 节点 kind：work_item / idea / ticket / test_case / page 等 */
    kind: KgNodeKind;
    /** 原始业务 id */
    refId: string;
    /** 图谱节点 id：{kind}:{refId} */
    nodeId: string;
}

/** 事件处理后通知打开中的关系图刷新。 */
export async function publishEntityChanged(
    action: EntityChangeAction,
    kind: KgNodeKind,
    refId: string | undefined,
): Promise<void> {
    if (!refId) {
        return;
    }
    const payload: EntityChangedPayload = {
        action,
        kind,
        refId,
        nodeId: kgNodeId(kind, refId),
    };
    try {
        await realtime.publish(ENTITY_CHANGED_CHANNEL, payload, { scope: "global" });
    } catch (error) {
        console.error("[graphs] realtime publish failed", action, kind, refId, error);
    }
}
