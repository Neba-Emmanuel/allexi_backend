import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { databaseClient } from "./client.js";
import { accountRouter } from "./account.js";
import { syncRequestSchema, syncResponseSchema, } from "../shared/src/index.js";
import { contentRouter } from "./content.js";
export function createApp(config) {
    const app = express();
    app.disable("x-powered-by");
    app.set("trust proxy", config.trustProxy ?? 0);
    app.use(helmet());
    app.use((req, res, next) => {
        const id = randomUUID();
        res.setHeader("X-Request-ID", id);
        res.setHeader("Cache-Control", "no-store");
        if (config.production) {
            const started = Date.now();
            res.on("finish", () => console.log(JSON.stringify({
                event: "request",
                requestId: id,
                method: req.method,
                path: req.path,
                status: res.statusCode,
                durationMs: Date.now() - started,
            })));
        }
        const origin = req.headers.origin;
        if (origin && !config.origins.includes(origin)) {
            res.status(403).json({ error: "Origin is not allowed" });
            return;
        }
        next();
    });
    app.use(cors({ origin: config.origins, exposedHeaders: ["ETag", "X-Request-ID"] }));
    app.use("/v1", rateLimit({
        windowMs: 60000,
        limit: 180,
        standardHeaders: "draft-8",
        legacyHeaders: false,
    }));
    app.use(express.json({ limit: "2mb" }));
    app.get("/live", (_req, res) => res.json({ status: "ok" }));
    app.get(["/health", "/ready"], async (_req, res) => {
        if (!config.url || !config.key) {
            res
                .status(503)
                .json({ status: "configuration_required", service: "allexi-api" });
            return;
        }
        try {
            const client = config.clientFactory?.() ?? databaseClient(config.url, config.key);
            const { data, error } = await client.rpc("app_readiness");
            const ready = !error && data === "202611130001";
            res.status(ready ? 200 : 503).json({
                status: ready ? "ok" : "dependency_unavailable",
                service: "allexi-api",
            });
        }
        catch {
            res
                .status(503)
                .json({ status: "dependency_unavailable", service: "allexi-api" });
        }
    });
    app.use("/v1", accountRouter(config));
    app.use("/v1", contentRouter(config));
    app.post("/v1/sync", async (req, res) => {
        const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
        if (!token) {
            res.status(401).json({ error: "Authentication required" });
            return;
        }
        if (!config.url || !config.key) {
            res.status(503).json({ error: "Cloud sync is not configured" });
            return;
        }
        const parsed = syncRequestSchema.safeParse(req.body);
        if (!parsed.success) {
            res
                .status(400)
                .json({ error: "Invalid changes", issues: parsed.error.issues });
            return;
        }
        // The user's JWT is passed to Postgres. No service-role key bypasses RLS.
        const client = config.clientFactory?.(token) ??
            databaseClient(config.url, config.key, token);
        const { data: { user }, error: authError, } = await client.auth.getUser(token);
        if (authError || !user) {
            res.status(401).json({ error: "Session is invalid or expired" });
            return;
        }
        const { data, error } = await client.rpc("sync_library", {
            changes: parsed.data.changes,
        });
        if (error) {
            console.error("sync_library failed", { code: error.code });
            res.status(503).json({ error: "Sync unavailable. Retry later." });
            return;
        }
        res.setHeader("Cache-Control", "no-store");
        const result = syncResponseSchema.safeParse(data);
        if (!result.success) {
            res
                .status(503)
                .json({ error: "Sync returned invalid data. Please retry later." });
            return;
        }
        res.json(result.data);
    });
    app.use((_req, res) => res.status(404).json({ error: "Route not found" }));
    const errors = (err, _req, res, _next) => {
        const status = err.type === "entity.too.large"
            ? 413
            : err instanceof SyntaxError
                ? 400
                : 500;
        if (status === 500)
            console.error("Unhandled API error", {
                requestId: res.getHeader("X-Request-ID"),
            });
        res.status(status).json({
            error: status === 413
                ? "Request too large"
                : status === 400
                    ? "Invalid JSON"
                    : "Internal server error",
        });
    };
    app.use(errors);
    return app;
}
