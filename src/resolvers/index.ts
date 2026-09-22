import { Resolver } from "@pc-nexus/core";
import { graphService } from "../services/graph.js";
import type { DependencyGraph, GetDependencyGraphPayload } from "../types/graph.js";

const resolver = new Resolver();

resolver.define<GetDependencyGraphPayload, DependencyGraph>(
    "getDependencyGraph",
    async (context, payload) => {
        return graphService.getDependencyGraph(context, payload ?? {});
    },
);

export { resolver };
