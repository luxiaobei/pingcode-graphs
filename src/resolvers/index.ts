import { Resolver } from "@pc-nexus/core";

const resolver = new Resolver();

resolver.define<string, string>("greeting", async (context, payload) => {
    return `Hello, ${payload}`;
});

export { resolver };
