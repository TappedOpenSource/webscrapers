import type { Browser, Page } from "puppeteer";
import puppeteer from "puppeteer";
import Sitemapper from "sitemapper";
import { metadata } from "./config";
import { ScrapedEventData } from "../../types";
import { v4 as uuidv4 } from "uuid";

async function getArtists(page: Page): Promise<string[]> {
  try {
    // Use evaluate to capture text content
    const artists = await page.evaluate(() => {
      function getTextContent(element: Element | ChildNode): string {
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

      const container = document.querySelector(".eventitem-title");
      if (!container) {
        return [];
      }
      const titleText = getTextContent(container).trim();

      return titleText.split(",").map((item) => item.trim());
    });

    return artists;
  } catch (e) {
    console.error(`[!!!] something broke, ${e}`);
    return [];
  }
}

async function getDate(page: Page): Promise<string[]> {
  try {
    // Use evaluate to capture text content
    const date = await page.evaluate(() => {
      function getTextContent(element: Element | ChildNode): string {
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

      const container = document.querySelector(".event-date");

      if (!container) {
        return [];
      }
      const titleText = getTextContent(container).trim();

      return titleText.split(",").map((item) => item.trim());
    });

    return date;
  } catch (e) {
    console.error(`[!!!] something broke, ${e}`);
    return [];
  }
}

async function getTime(page: Page): Promise<string[]> {
  try {
    // Use evaluate to capture text content
    const time = await page.evaluate(() => {
      function getTextContent(element: Element | ChildNode): string {
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

      const container = document.querySelector(".event-time-12hr-start");

      if (!container) {
        return [];
      }
      const titleText = getTextContent(container).trim();

      return titleText.split(",").map((item) => item.trim());
    });

    return time;
  } catch (e) {
    console.error(`[!!!] something broke, ${e}`);
    return [];
  }
}

async function scrapeEvent(
  url: string,
  browser: Browser,
): Promise<ScrapedEventData> {
  const page = await browser.newPage();
  await page.goto(url);

  const eventArtists: string[] = await getArtists(page);
  const eventDate: string[] = await getDate(page);
  const eventTime: string[] = await getTime(page);

  // Combine date and time and convert to Date object
  const combinedDate: string = eventDate.join(" ");
  const combinedTime: string = eventTime[0];
  const dateTimeString: string = `${combinedDate} ${combinedTime}`;
  const dateTime: Date = new Date(dateTimeString);

  console.log({
    dateTime,
    eventDate,
    eventTime,
    url,
    eventArtists,
  });

  const id = uuidv4();

  return {
    id,
    url,
    isMusicEvent: true,
    title: eventArtists.join(", "),
    description: "",
    ticketPrice: null,
    artists: eventArtists,
    startTime: dateTime,
    endTime: dateTime,
    flierUrl: null,
  };
}

async function scrape() {
  const sitemap = new Sitemapper({
    url: metadata.sitemap,
  });
  const browser = await puppeteer.launch();
  const response = await sitemap.fetch();
  const { sites } = response;

  const filteredSites = sites.filter((site) =>
    site.includes("live-music-calendar"),
  );

  for (const s of filteredSites) {
    await scrapeEvent(s, browser);
  }

  await browser.close();
}

scrape();
