import { readConfig } from "../src/config.ts";

const force = process.argv.includes("--vercel");
if (force || (process.env.VERCEL === "1" && process.env.VERCEL_ENV !== "development")) {
  try {
    readConfig({
      ...process.env,
      VERCEL: "1",
      VERCEL_ENV: force ? "production" : process.env.VERCEL_ENV,
    });
    console.log("Vercel runtime configuration is valid. No credentials were printed.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid runtime configuration");
    process.exitCode = 1;
  }
}
