import type { NexusAppContext } from "@pc-nexus/core";
import { kvs } from "@pc-nexus/storage";

const KEY_PREFIX = "graph-display-settings:";

/** 展示配置开关。没有用户、没有记录或读失败时，resolver 返回全部打开。 */
export type DisplaySettingFlags = Record<string, boolean>;

const SETTING_IDS = ["parent", "relate", "dependency", "product", "ticket", "test", "objective"] as const;

function allOn(): DisplaySettingFlags {
    return Object.fromEntries(SETTING_IDS.map((id) => [id, true]));
}

/** 只保留已知开关里的布尔值。没有有效值时返回 null。 */
function readFlags(value: unknown): DisplaySettingFlags | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const record = value as Record<string, unknown>;
    const flags: DisplaySettingFlags = {};
    for (const id of SETTING_IDS) {
        if (typeof record[id] === "boolean") {
            flags[id] = record[id];
        }
    }
    return Object.keys(flags).length > 0 ? flags : null;
}

function storageKey(userId: string): string {
    return `${KEY_PREFIX}${userId}`;
}

export async function getDisplaySettings(context: NexusAppContext): Promise<DisplaySettingFlags> {
    const userId = context.user?.id;
    if (!userId) {
        return allOn();
    }
    try {
        return { ...allOn(), ...readFlags(await kvs.get<DisplaySettingFlags>(storageKey(userId))) };
    } catch {
        return allOn();
    }
}

export async function saveDisplaySettings(context: NexusAppContext, payload: unknown): Promise<void> {
    const userId = context.user?.id;
    const flags = readFlags(payload);
    if (!userId || !flags) {
        return;
    }
    await kvs.set(storageKey(userId), flags);
}
