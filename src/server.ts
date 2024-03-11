import Fastify from "fastify";
import schedule from "node-schedule";
import { scrapers } from "./scrapers";
import { getLatestRun } from "./utils/database";
import { configDotenv } from "dotenv";

const port = parseInt(process.env.PORT || "3000");
const host = process.env.ADDRESS || "0.0.0.0";
const fastify = Fastify({
  logger: true,
});

fastify.get("/", async function handler() {
  return { status: "ok" };
});

fastify.get("/health", async function handler() {
  return { status: "ok" };
});

fastify.get("/version", async function handler() {
  const metadata = scrapers.map((scraper) => scraper.metadata);
  return {
    metadata,
  };
});

fastify.get("/latest", async function handler() {
  const latestRuns = await Promise.all(
    scrapers.map(async (scraper) => {
      const latestRun = await getLatestRun(scraper.metadata);
      return latestRun;
    }),
  );

  return {
    latestRuns,
  };
});

export async function startServer() {
  try {
    let offset = 0;
    for (const scraper of scrapers) {
      fastify.log.info(
        `scheduling ${scraper.metadata.name} to ${offset} past midnight`,
      );
      schedule.scheduleJob(`0 ${offset} * * *`, async () => {
        try {
          await scraper.run({ online: true });
        } catch (err) {
          fastify.log.error(err);
        }
      });
      offset++;
    }

    await fastify.listen({
      host,
      port,
    });
  } catch (err) {
    fastify.log.error(err);
    return;
  }
}

if (require.main === module) {
  configDotenv({
    path: ".env",
  });

  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
