import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { prisma } from "./prisma";

import { adminRoutes } from "./routes/admin";
import { driverRoutes } from "./routes/driver";
import { clientRoutes } from "./routes/cliente";

async function main() {
    const app = Fastify({ logger: true });

    await app.register(cors, { origin: true });

    app.get("/health", async () => ({ ok: true }));

    app.get("/debug/db", async () => {
        const now = await prisma.$queryRaw`SELECT NOW() as now`;
        return { ok: true, now };
    });

    await app.register(adminRoutes, { prefix: "/admin" });
    await app.register(driverRoutes, { prefix: "/driver" });
    await app.register(clientRoutes, { prefix: "/cliente" });

    const port = Number(process.env.PORT || 3000);
    await app.listen({ port, host: "0.0.0.0" });
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});