import { createApp } from "./app.js";
import { readConfig } from "./config.js";
const config = readConfig(process.env);
const app = createApp(config);
const server = app.listen(config.port, "0.0.0.0", () =>
  console.log(
    JSON.stringify({
      event: "api_started",
      port: config.port,
      production: config.production,
    }),
  ),
);
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.keepAliveTimeout = 5000;
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    console.log(JSON.stringify({ event: "api_stopping", signal }));
    const timer = setTimeout(() => process.exit(1), 15000);
    timer.unref();
    server.close(() => {
      clearTimeout(timer);
      process.exit(0);
    });
    server.closeIdleConnections();
  });
