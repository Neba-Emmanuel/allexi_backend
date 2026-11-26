import type { Express } from "express";
import { createApp } from "./src/app.js";
import { readConfig } from "./src/config.js";

// Vercel owns the HTTP listener and lifecycle; the local server stays in src/server.ts.
const app: Express = createApp(readConfig(process.env));
export default app;
