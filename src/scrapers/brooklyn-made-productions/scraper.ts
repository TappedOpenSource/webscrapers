import type { Browser, Page } from "puppeteer";
import puppeteer from "puppeteer";
import Sitemapper from "sitemapper";
import { config } from "./config";
import { ScrapedEventData } from "../../types";
import { v4 as uuidv4 } from "uuid";
import {
  endScrapeRun,
  saveScrapeResult,
} from "../../utils/database";
import {
  notifyOnScrapeFailure,
  notifyOnScrapeSuccess,
} from "../../utils/notifications";
import { configDotenv } from "dotenv";
import { initScrape } from "../../utils/startup";


async function getArtists(page: Page): Promise<string[]> {
  const artistElements = await page.$$eval(
    ".tribe-events-single-event-title",
    (elements) => elements.map((el) => el.textContent?.trim() ?? "")
  );
  return artistElements;
}

async function getDate(page: Page): Promise<string[]> {
  const dateElements = await page.$$eval(
    ".tribe-event-date-start",
    (elements) => elements.map((el) => el.textContent?.trim() ?? "")
  );
  return dateElements;
}

async function getTime(page: Page): Promise<string[]> {
  const timeElements = await page.$$eval(
    ".tribe-events-schedule h3",
    (elements) => elements.map((el) => el.textContent?.trim() ?? "")
  );
  return timeElements;
}

async function scrapeEvent(
  browser: Browser,
  url: string
): Promise<ScrapedEventData | null> {
  const page = await browser.newPage();
  await page.goto(url);

  const eventArtists: string[] = await getArtists(page);
  const eventDate: string[] = await getDate(page);
  const eventTime: string[] = await getTime(page);

  // Combine date and time and convert to Date object
  const combinedDate: string = eventDate.join(" ");
  const combinedTime: string = eventTime.join(", ");
  const dateTimeString: string = `${combinedDate} ${combinedTime}`;
  const dateTime: Date = new Date(dateTimeString);

  const id = uuidv4();

  return {
    id,
    url,
    isMusicEvent: true,
    title: eventArtists.join(", "),
    description: "",
    ticketPrice: null,
    doorPrice: null,
    artists: eventArtists,
    startTime: dateTime,
    endTime: dateTime,
    flierUrl: null,
  };
}

export async function scrape({ online }: { online: boolean }): Promise<void> {
  console.log(`[+] scraping [online: ${online}]`);
  const { latestRun, runId, metadata } = await initScrape({ online, config });

  try {
    const lateRunStart = latestRun?.startTime ?? null;
    const lastmod = lateRunStart?.getTime();
    const sitemap = new Sitemapper({
      url: config.sitemap,
      lastmod,
      timeout: 30000,
    });

    const { sites } = await sitemap.fetch();

    console.log("[+] urls:", sites.length);

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
