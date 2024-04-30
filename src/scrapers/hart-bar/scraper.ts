import puppeteer from "puppeteer";
import { ScrapedEventData } from "../../types";
import { endScrapeRun, saveScrapeResult } from "../../utils/database";
import {
  notifyOnScrapeFailure,
  notifyOnScrapeSuccess,
  notifyScapeStart,
} from "../../utils/notifications";
import {
  getBookingsFromCalendar,
  parseArtists,
  parseTicketPrice,
  parseDescription,
  parseDates,
} from "./parsing";
import { config } from "./config";
import { configDotenv } from "dotenv";
import { v4 as uuidv4 } from "uuid";
import { initScrape } from "../../utils/startup";
import { calendar_v3 } from "googleapis";

async function scrapeEvent(
  event: calendar_v3.Schema$Event
): Promise<ScrapedEventData | null> {
  const summary = event.summary ?? null;
  const description = event.description ?? null;
  const calendarStartTime = event.start?.dateTime ? event.start.dateTime : new Date();
  const calendarEndTime = event.end?.dateTime ? event.end.dateTime : new Date();
  const calendarUrl = event.htmlLink ?? "";

  const eventName = summary;
  if (!eventName) {
    console.log("[-] title not found");
    return null;
  }
  console.log("[+] scraping event:", eventName);
  const plainDescription = parseDescription(description);

  const [startTime, endTime] = await parseDates(plainDescription ?? "", new Date(calendarStartTime) , new Date(calendarEndTime));
  const [ticketPrice, doorPrice] = parseTicketPrice(plainDescription ?? "");

  const { isMusicEvent, artists } = await parseArtists(eventName, summary);


  const id = uuidv4();

  return {
    id,
    url: calendarUrl,
    isMusicEvent: isMusicEvent,
    title : eventName,
    description: plainDescription,
    ticketPrice:  ticketPrice,
    doorPrice:  doorPrice,
    artists : artists,
    startTime: new Date(startTime),
    endTime: new Date(endTime),
    flierUrl: null,
  };
}

export async function scrape({ online }: { online: boolean }): Promise<void> {
  console.log(`[+] scraping [online: ${online}]`);
  const { latestRun, runId, metadata } = await initScrape({ config, online });


  try {
    const lateRunStart = latestRun?.startTime ?? null;
    const lastmod = lateRunStart?.getTime();
    console.log(`[+] last mode is ${lastmod}`);

    // Launch the browser and open a new blank page
    const browser = await puppeteer.launch({
      headless: "new",
    });
    const calendarUrl = metadata.url
    const page = await browser.newPage();
    await page.goto(calendarUrl);
    await page.setViewport({ width: 1080, height: 1024 });
    

    const src = await page.evaluate(() => {
      const iframe = document.querySelector("iframe");
      return iframe ? iframe.src : null;
    });
    let calendarID;
    if (src) {
      const urlParams = new URLSearchParams(new URL(src).search);
      calendarID = urlParams.get("src");
    } else {

      console.log("[-] failed to find calendar ID");
      calendarID=null;
    }
    let events: calendar_v3.Schema$Event[] = [];
    if (calendarID) {
      events = await getBookingsFromCalendar(calendarID);
    }
    await notifyScapeStart({
      runId,
      eventCount: events.length,
    });
    for (const event of events) {
      try {
        const data = await scrapeEvent(event);
        if (data === null) {
          console.log("[-] failed to scrape data");
          continue;
        }
        console.log(
          `[+] \n- ${data.title}\n - ${data.artists.join(",")}\n - [${data.startTime.toLocaleString()} - ${data.endTime.toLocaleString()}]\n- ${data.flierUrl}`,
        );
        
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
        eventCount: 0,
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
