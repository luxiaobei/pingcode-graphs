import { Resolver } from "@pc-nexus/core";
import { graphService } from "../services/graph.js";
import type { DependencyGraph, GetDependencyGraphPayload } from "../types/graph.js";
import { kgService, type GetDeepRelationPayload, type KgDeepRelation } from "../services/kg-service.js";

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

export { resolver };
