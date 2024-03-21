import puppeteer, { type Browser } from "puppeteer";
import Sitemapper from "sitemapper";
import { ScrapedEventData } from "../../types";
import { endScrapeRun, saveScrapeResult } from "../../utils/database";
import { config } from "./config";
import {
  notifyOnScrapeFailure,
  notifyOnScrapeSuccess,
  notifyScapeStart,
} from "../../utils/notifications";
import {
  getEventNameFromUrl,
  parseArtists,
  parseTicketPrice,
  parseDescription,
  parseTimes,
} from "./parsing";
import { v4 as uuidv4 } from "uuid";
import { configDotenv } from "dotenv";
import { initScrape } from "../../utils/startup";

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

  const element = await page.waitForSelector("body > div.containerRight > section > div > div > div.col.l7 > div.headings > h5");

  if (!element) {
    console.log("[-] element not found");
    return null;
  }

  const title = (
    (await page.evaluate((element) => element.textContent, element)) ?? ""
  ).trim();
  const description = (await parseDescription(page)) ?? "";

  const priceContainer = await page.waitForSelector("body > div.containerRight > section > div > div > div.col.l7 > div.shortDesc > p:nth-child(1)");

  if (!priceContainer) {
    console.log("[-] price not found");
    return null;
  }

  const price = (
    (await page.evaluate(
      (priceContainer) => priceContainer.textContent,
      priceContainer,
    )) ?? ""
  ).trim();

  // null if price string is empty
  const [ticketPrice, doorPrice] = parseTicketPrice(price);

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

    const timeContainer = document.querySelector("body > div.containerRight > section > div > div > div.col.l7 > div.shortDesc > p:nth-child(1)");
    if (timeContainer === null) {
      console.log("[-] container not found");
      return {
        startTime: null,
        endTime: null,
      };
    }
    const dateContainer = document.querySelector(".event-date");
    if (dateContainer === null) {
      console.log("[-] container not found");
      return {
        startTime: null,
        endTime: null,
      };
    }


    const timeString = getTextContent(timeContainer).trim();
    const dateString = getTextContent(dateContainer).trim();

    //const dateTimeString = timeString + " " + dateString

    
    // Define a regex pattern to capture date and time components
    const timeRegexPattern =
      /(\d+)(?=pm)/gm;
    const dateRegexPattern = 
      /(\b\d{1,2}\b\s+\b\w+\b)/gm;
    // Create an array to store matched groups
    let match;
    const matches = [];

    // Iterate over matches using the regex pattern
    while ((match = timeRegexPattern.exec(timeString)) !== null) {
      matches.push(match.slice(1));
    }
    while((match = dateRegexPattern.exec(dateString)) !== null) {
      matches.push(match.slice(1))
    }
    const month = matches[2][0]

    const splitMonth = month.split(/\s+/)



    const startTime = [];
    const endTime = [];
    const currDate = new Date();
    const year = String(currDate.getFullYear());
    if (matches[2][0]) {
      const monthString = String(splitMonth[1])
      const dayString = String(splitMonth[0]);
      startTime.push(monthString)
      startTime.push(dayString)
      
      startTime.push(year)
      endTime.push(monthString);
      endTime.push(dayString);
      endTime.push(year);
      if (matches[1][0]) {
        const showTimeString = String(matches[1][0]);
        
        startTime.push(showTimeString + ":00PM")
        const endTimeString =
        String(Number(showTimeString) + 2) + ":00PM";
        endTime.push(endTimeString);
        if (matches[0][0]) {
          const doorTimeString = String(matches[0][0]);
          console.log(doorTimeString)
        }
      }
    }

    return {
      startTimeStr: startTime ?? null,
      endTimeStr: endTime ?? null,
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
    isMusicEvent: true,
    title,
    description,
    ticketPrice: ticketPrice ?? null,
    doorPrice: doorPrice ? doorPrice : ticketPrice ?? null,
    artists,
    startTime,
    endTime,
    flierUrl: null,
  };
}

export async function scrape({ online }: { online: boolean }): Promise<void> {
  console.log(`[+] scraping old town [online: ${online}]`);
  const { latestRun, runId, metadata } = await initScrape({ config, online });
  console.log(metadata)
  try {
    const lateRunStart = latestRun?.startTime ?? null;
    const lastmod = lateRunStart?.getTime();
    console.log(lastmod);

    const sitemap = new Sitemapper({
      url: metadata.sitemap,
  
      timeout: 30000,
    });

    const { sites } = await sitemap.fetch();
    //const sites = ["https://otpsteamboat.com/events/aqueous-at-otp/"];

    console.log("[+] old town urls:", sites.length);
    
    await notifyScapeStart({
      runId,
      eventCount: sites.length,
    });
    

    // Launch the browser and open a new blank page
    const browser = await puppeteer.launch({
      headless: "new",
      //headless: false,
    });

    for (const oldTownUrl of sites) {
      try {
        const data = await scrapeEvent(browser, oldTownUrl);
        if (data === null) {
          console.log("[-] failed to scrape data");
          continue;
        }

        // console.log(
        //   `[+] scraped data: ${data.title} - #${data.artists.join("|")}# [${data.startTime.toLocaleString()} - ${data.endTime.toLocaleString()}]`,
        // );
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
