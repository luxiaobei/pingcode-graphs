import { Resolver } from "@pc-nexus/core";
import {
    getDisplaySettings,
    saveDisplaySettings,
    type DisplaySettingFlags,
} from "../services/display-settings.js";
import { graphService } from "../services/graph.js";
import type { DependencyGraph, GetDependencyGraphPayload } from "../types/graph.js";
import {
    kgService,
    type GetDeepRelationPayload,
    type KgDeepRelation,
    type GetViewPositionPayload,
    type SaveViewPositionPayload,
} from "../services/kg-service.js";

const resolver = new Resolver();

resolver.define<GetDependencyGraphPayload, DependencyGraph>(
    "getDependencyGraph",
    async (context, payload) => {
        return graphService.getDependencyGraph(context, payload ?? {});
    },
);

resolver.define<GetDeepRelationPayload, KgDeepRelation>(
    "getDeepRelation",
    async (context, payload) => {
        return kgService.getDeepRelation(context, payload.nodeId, payload.type, payload.depth, payload.direction);
    },
);

resolver.define<SaveViewPositionPayload, void>("saveViewPosition", async (context, payload) => {
    await kgService.saveViewPosition(context, payload.nodeId, payload.position, payload.relationSides);
});

resolver.define<GetViewPositionPayload, Record<string, unknown> | null>("getViewPosition", async (context, payload) => {
    return kgService.getViewPosition(context, payload.nodeId);
});

resolver.define<undefined, DisplaySettingFlags>("getDisplaySettings", async (context) => {
    return getDisplaySettings(context);
});

resolver.define<unknown, void>("saveDisplaySettings", async (context, payload) => {
    await saveDisplaySettings(context, payload);
});

export { resolver };
