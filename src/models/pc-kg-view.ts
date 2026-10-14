export const KG_VIEW_ENTITY_NAME = "pc_kg_view";

/** 同一用户对同一主题节点至多一条视图位置。 */
export interface KgView {
    id: string;
    user_id: string;
    node_id: string;
    /** 视图位置，结构由调用方决定，存储层原样保存。 */
    position: Record<string, unknown>;
}

export function kgViewId(userId: string, nodeId: string): string {
    return `${userId}|${nodeId}`;
}
