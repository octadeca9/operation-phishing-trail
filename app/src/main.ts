import { createApp } from "./app.js";
import { config, assertSafeForPublic } from "./config.js";
import { logger } from "./observability/logger.js";

function main(): void {
  assertSafeForPublic();
  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info("server_started", {
      port: config.port,
      env: config.appEnv,
      auth_mode: config.authMode,
      challenge_id: config.challengeId,
    });
  });

  const shutdown = (sig: string) => {
    logger.info("server_stopping", { signal: sig });
    server.close(() => process.exit(0));
    // Paksa keluar jika koneksi menggantung.
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main();
