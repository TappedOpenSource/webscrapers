import puppeteer, { type Browser } from "puppeteer";
import Sitemapper from "sitemapper";
import { ScrapedEventData } from "../../types";
import {
  endScrapeRun,
  getLatestRun,
  saveScrapeResult,
  startScrapeRun,
} from "../../utils/database";
import { metadata } from "./config";
import {
  notifyOnScrapeFailure,
  notifyOnScrapeSuccess,
} from "../../utils/notifications";
import {
  getEventNameFromUrl,
  parseArtists,
  parseTicketPrice,
  parseTimes,
} from "./parsing";
import { v4 as uuidv4 } from "uuid";
import { configDotenv } from "dotenv";

function getUnixTimestampForYesterday() {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  return Math.floor(yesterday.getTime() / 1000);
}

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
  // page.on('console', async (msg) => {
  //     const msgArgs = msg.args();
  //     for (let i = 0; i < msgArgs.length; ++i) {
  //         const val = await msgArgs[i].jsonValue();
  //         console.log(`[PAGE] ${val}`);
  //     }
  // });

  // Navigate the page to a URL
  await page.goto(eventUrl);

  // Set screen size
  await page.setViewport({ width: 1080, height: 1024 });

  const element = await page.waitForSelector(".page-title");

  if (!element) {
    console.log("[-] element not found");
    return null;
  }

  const title = (
    (await page.evaluate((element) => element.textContent, element)) ?? ""
  ).trim();

  // Use evaluate to capture text content
  const description = await page.evaluate(() => {
    function getTextContent(element: Element | ChildNode) {
      var text = "";

      var descriptionContainer = document.querySelector(
        ".eventitem-column-content",
      );
      var descriptionLines = descriptionContainer
        ? descriptionContainer.querySelectorAll("p")
        : null;
      if (descriptionLines) {
        descriptionLines.forEach((line) => {
          var lineText = line.textContent;
          if (!line.classList.contains("entry-actions")) {
            lineText = lineText ? lineText.replace(" /", ".") : lineText;
            text = text + " " + lineText;
          }
        });
      }
      return text;
    }

    const container = document.querySelector(".eventitem-column-content");

    if (!container) {
      return "";
    }
    return getTextContent(container).trim();
  });

  const ticketPrice = parseTicketPrice(description) ?? 5;

  const { startTimeStr, endTimeStr } = await page.evaluate(() => {
    function getTextContent(element: Element | ChildNode) {
      let text = "";

      // Iterate over child nodes
      element.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          text += ` ${node.textContent} `;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          text += ` ${getTextContent(node)} `;
        }
      });

      return text;
    }

    const container = document.querySelector(".event-time");
    if (container === null) {
      console.log("[-] container not found");
      return {
        startTime: null,
        endTime: null,
      };
    }

    const dateString = getTextContent(container).trim();

    // Define a regex pattern to capture date and time components
    const regexPattern =
      /\s*(\w+), (\w+)\s*(\d{1,2}), (\d{4})\s*(\d{1,2}:\d{2}(?:am|pm))\s*–\s*(\d{1,2}:\d{2}(?:am|pm))/g;
    //const regexPattern = /\s*(\w+), (\w+)\s*(\d{1,2}), (\d{4})\s*(\d{1,2}:\d{2}(?:am|pm))\s*–\s*(\d{1,2}:\d{2}(?:am|pm))?\s*/g;

    // Create an array to store matched groups
    let match;
    const matches = [];
    // Iterate over matches using the regex pattern
    while ((match = regexPattern.exec(dateString)) !== null) {
      matches.push(match.slice(1));
    }

    const amOrPm = String(matches[4]).slice(2, 4) === "pm" ? "pm" : "am";
    const defaultEndTime =
      String(Number(matches[0][4].substring(0, 2)) + 2) + amOrPm;
    const startTimes = [];
    const endTimes = [];
    if (matches) {
      startTimes.push(String(matches[0][0]));
      startTimes.push(String(matches[0][1]));
      startTimes.push(String(matches[0][2]));
      startTimes.push(String(matches[0][3]));
      startTimes.push(String(matches[0][4]));

      endTimes.push(String(matches[0][0]));
      endTimes.push(String(matches[0][1]));
      endTimes.push(String(matches[0][2]));
      endTimes.push(String(matches[0][3]));
      if (matches[0].length === 6) {
        endTimes.push(String(matches[0][5]));
      } else {
        endTimes.push(defaultEndTime);
      }
    }
    matches.push(startTimes);
    matches.push(endTimes);

    return {
      startTimeStr: matches ? startTimes : null,
      endTimeStr: matches ? endTimes : null,
    };
  });

  if (!startTimeStr || !endTimeStr) {
    console.log("[-] start or end time not found");
    return null;
  }

  const { startTime, endTime } = parseTimes(startTimeStr, endTimeStr);

  if (!startTime || !endTime) {
    console.log(`[-] start or end time not found [${startTime}, ${endTime}]`);
    return null;
  }

  const artists = await parseArtists(title);

  const id = uuidv4();

  return {
    id,
    url: eventUrl,
    title,
    description,
    ticketPrice,
    artists,
    startTime,
    endTime,
    flierUrl: null,
  };
}

export async function scrape({ online }: { online: boolean }): Promise<void> {
  console.log(`[+] scraping golden pony [online: ${online}]`);
  const latestRun = await getLatestRun(metadata);
  const runId = online ? await startScrapeRun(metadata) : "test-run";

  try {
    const lateRunStart = latestRun?.startTime ?? null;
    const lastmod =
      lateRunStart !== null
        ? lateRunStart.getTime()
        : getUnixTimestampForYesterday() * 1000;

    const sitemap = new Sitemapper({
      url: metadata.sitemap,
      //lastmod,
      lastmod: new Date("2023-01-01").getTime(),
      timeout: 30000,
    });

    const { sites } = await sitemap.fetch();

    console.log("[+] golden pony urls:", sites.length);

    // Launch the browser and open a new blank page
    const browser = await puppeteer.launch({
      headless: "new",
    });

    for (const goldenPonyUrl of sites) {
      try {
        const data = await scrapeEvent(browser, goldenPonyUrl);
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
    //await browser.close();

    if (online) {
      await endScrapeRun(metadata, runId, { error: null });
      await notifyOnScrapeSuccess({
        runId,
        eventCount: sites.length,
      });
    }
  } catch (err: any) {
    console.log("[-] error:", err);
    if (online) {
      await endScrapeRun(metadata, runId, { error: err.message });
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

  scrape({ online: true });
}
