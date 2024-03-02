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
  const yesterday = new Date(now.getTime() - (24 * 60 * 60 * 1000));
  return Math.floor(yesterday.getTime() / 1000);
}

async function scrapeEvent(browser: Browser, eventUrl: string): Promise<ScrapedEventData | null> {
  const eventName = getEventNameFromUrl(eventUrl);

  if (!eventName) {
    console.log('[-] event name not found: ', eventUrl);
    return null;
  }

  console.log('[+] scraping event:', eventName);

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

  const element = await page.waitForSelector('.event-title');

  if (!element) {
    console.log('[-] element not found');
    return null;
  }

  const title = (await page.evaluate(element => element.textContent, element) ?? '').trim();

  // Use evaluate to capture text content
  const description = await page.evaluate(() => {
    function getTextContent(element: Element | ChildNode) {
      var text = '';
      
      
      element.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          text += ` ${node.textContent} `;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          text += ` ${getTextContent(node)} `;
        }
      });

      return text;
    };
   
    

    const container = document.querySelector('.tw-description');

    if (!container) {
      return '';
    }
    return getTextContent(container).trim();
  });
  
  const priceContainer = await page.waitForSelector('.tw-price');
  let advTicketPrice = null;
  let doorTicketPrice = null;
  let ticketPrice = null;
  if (priceContainer) {
    let priceContent = (await page.evaluate(priceContainer => priceContainer.textContent, priceContainer));
    priceContent = priceContent ?? '';
    priceContent = priceContent.trim() === '' ? '' : priceContent.trim();

    
    if (priceContent.includes("-")) {
      const splitPriceString = priceContent.split("-");
      const advTicketString = splitPriceString[0]
      const doorPriceString = splitPriceString[1]
      advTicketPrice = advTicketString.trim();
      doorTicketPrice = doorPriceString.trim()
      advTicketPrice = Number(advTicketPrice.slice(1));
      doorTicketPrice = Number(doorTicketPrice.slice(1));


    } else {
      let priceString;
      if (priceContent !== '') {
        priceString = priceContent.trim();
        ticketPrice = Number(priceString.slice(1));
      }
      
    };

    //const priceString = (await page.evaluate(priceContainer => priceContainer.textContent, priceContainer) ?? '5').trim();
    
    
  } else {
    ticketPrice = 5;
  }
  //const ticketPrice = parseTicketPrice(description) ?? 5;

  const { startTimeStr, endTimeStr } = await page.evaluate(() => {
    function getTextContent(element: Element | ChildNode) {
      let text = '';

      // Iterate over child nodes
      element.childNodes.forEach((node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          text += ` ${node.textContent} `;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          text += ` ${getTextContent(node)} `;
        }
      });

      return text;
    };
    

    const container = document.querySelector('.tw-date-time');
    if (container === null) {
      console.log('[-] container not found');
      return {
        startTime: null,
        endTime: null,
      };
    }

    const dateString = getTextContent(container).trim();
    // Define a regex pattern to capture date and time components
    const regexPattern = /(\w+)\s+(\w+)\s+(\w+)\s+(\d{1,2}:\d{2}\s+(?:am|pm))/gm;

    // Create an array to store matched groups
    let match;
    const matches = [];

    // Iterate over matches using the regex pattern
    while ((match = regexPattern.exec(dateString)) !== null) {
      matches.push(match.slice(1));
    }

    const startTime = [];
    const endTime = [];
    const currDate = new Date();
    const year = String(currDate.getFullYear());

    if (matches[0]) {
      const monthString = String(matches[0][1]);
      const numberDayString = String(matches[0][2]);
      const startTimeString = String(matches[0][3]);
      const splitTimeString = startTimeString.split(":");
      const endTimeString = String(Number(splitTimeString[0]) + 2) + ":" + splitTimeString[1];

      startTime.push(monthString);
      startTime.push(numberDayString);
      startTime.push(year);
      startTime.push(startTimeString);

      endTime.push(monthString);
      endTime.push(numberDayString);
      endTime.push(year);
      endTime.push(endTimeString);
    }

    return {
      startTimeStr: startTime ?? null,
      endTimeStr: endTime ?? null,
    };
  });



  if (!startTimeStr || !endTimeStr) {
    console.log('[-] start or end time not found');
    return null;
  }

  const { startTime, endTime } = parseTimes(startTimeStr, endTimeStr);
  /*
  console.log(title)
  console.log(description)
  console.log(ticketPrice)
  console.log(advTicketPrice)
  console.log(doorTicketPrice)
  console.log(startTime)
  console.log(endTime)
*/
  if (!startTime || !endTime) {
    console.log(`[-] start or end time not found [${startTime}, ${endTime}]`);
    return null;
  }

  const artists = await parseArtists(title);
  
  const id = uuidv4();

  return {
    id,
    url: eventUrl,
    isMusicEvent:true,
    title,
    description,
    ticketPrice: ticketPrice ?? null,
    advTicketPrice: ticketPrice ? ticketPrice : advTicketPrice,
    doorTicketPrice: ticketPrice ? ticketPrice : doorTicketPrice,
    artists,
    startTime,
    endTime,
    flierUrl: null,
  }
}

export async function scrape({ online }: { online: boolean }): Promise<void> {
  console.log(`[+] scraping pearl street [online: ${online}]`);
  const latestRun = await getLatestRun(metadata);
  const runId = online ? await startScrapeRun(metadata) : "test-run";

  try {
    const lateRunStart = latestRun?.startTime ?? null;
    const lastmod = lateRunStart?.getTime();

    const sitemap = new Sitemapper({
      url: metadata.sitemap,
      lastmod,
      timeout: 30000,
    });

    const { sites } = await sitemap.fetch();

    console.log("[+] pearl street urls:", sites.length);

    // Launch the browser and open a new blank page
    const browser = await puppeteer.launch({
      headless: "new",
    });

    for (const pearlStreetUrl of sites) {
      try {
        const data = await scrapeEvent(browser, pearlStreetUrl);
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
