import puppeteer, { type Browser } from "puppeteer";
import Sitemapper from "sitemapper";
import { ScrapedEventData } from "../../types";
import {
  endScrapeRun,
  getLatestRun,
  saveScrapeResult,
  startScrapeRun,
} from "../../utils/database";
import {
  notifyOnScrapeFailure,
  notifyOnScrapeSuccess,
} from "../../utils/notifications";
import {
  getArtists,
  getEventDescription,
  getEventNameFromUrl,
  getEventTitle,
  getFlierUrl,
  parsePage,
  parseTimes,
  // parseArtists,
  // parseTicketPrice,
  // parseTimes,
} from "./parsing";
import { metadata } from "./config";
import { configDotenv } from "dotenv";
import { v4 as uuidv4 } from "uuid";

async function scrapeEvent(
  browser: Browser,
  eventUrl: string,
): Promise<ScrapedEventData | null> {
  const eventName = getEventNameFromUrl(eventUrl);

  if (!eventName) {
    console.log("[-] event name not found: ", eventUrl);
    return null;
  }

  console.log("[+] scraping event:", eventName);
  const page = await browser.newPage();
  await page.goto(eventUrl);
  await page.setViewport({ width: 1080, height: 1024 });

  const id = uuidv4();
  const flierUrl = await getFlierUrl(page);
  const { isMusicEvent, title, description, startTime, endTime, artists } =
    await parsePage(page);

  if (!isMusicEvent) {
    console.log("[-] not a music event");
    return null;
  }

  return {
    id,
    url: eventUrl,
    title,
    description,
    ticketPrice: null,
    artists,
    startTime,
    endTime,
    flierUrl,
  };
}

export async function scrape({ online }: { online: boolean }): Promise<void> {
  console.log(`[+] scraping [online: ${online}]`);
  const latestRun = await getLatestRun(metadata);
  const runId = online ? await startScrapeRun(metadata) : "test-run";

  try {
    const lateRunStart = latestRun?.startTime ?? null;
    const lastmod = lateRunStart?.getTime();
    console.log(`[+] last mode is ${lastmod}`);
    const sitemap = new Sitemapper({
      url: metadata.sitemap,
      lastmod,
      // lastmod: (new Date('2024-02-01')).getTime(),
      timeout: 30000,
    });

    const { sites } = await sitemap.fetch();

    console.log("[+] urls:", sites.length);

    // Launch the browser and open a new blank page
    const browser = await puppeteer.launch({
      headless: "new",
    });

    for (const url of sites) {
      try {
        const data = await scrapeEvent(browser, url);
        if (data === null) {
          console.log("[-] failed to scrape data");
          continue;
        }

        // console.log(`[+] scraped data: ${data.title} - #${data.artists.join('|')}# [${data.startTime.toLocaleString()} - ${data.endTime.toLocaleString()}]`);
        if (online) {
          await saveScrapeResult(metadata, runId, data);
        }
      } catch (e) {
        console.log("[!!!] error:", e);
        continue;
      }
    }
    await browser.close();

    if (online) {
      await endScrapeRun(metadata, runId, { error: null });
      await notifyOnScrapeSuccess({
        runId,
        eventCount: sites.length,
      });
    }
  } catch (err: any) {
    console.log("[-] error:", err);
    await endScrapeRun(metadata, runId, { error: err.message });
    if (online) {
      await notifyOnScrapeFailure({
        error: err.message,
      });
    }
    throw err;
  }
}

if (require.main === module) {
  configDotenv({
    path: ".env",
  });

  scrape({ online: false });
}
