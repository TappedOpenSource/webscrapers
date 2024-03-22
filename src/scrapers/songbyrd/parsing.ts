import type { Page } from "puppeteer";

export function getEventNameFromUrl(url: string) {
  const pathname = new URL(url).pathname;

  // Regular Expression to capture the event name after /calendar/
  // It will not match if there's only /calendar with nothing after
  const eventNameRegex = /^\/event\/(.+)$/;

  // Apply the regex and return the captured group if matched, otherwise null
  const match = pathname.match(eventNameRegex);
  return match ? match[1] : null;
}

export async function parseDates(page: Page) {
  const element = await page.$$eval(
    ".wpem-event-date-time",
    (el) => el[0].outerHTML,
  );

  const htmlContent = element;

  // Regular expression pattern to match date and time
  const dateTimeRegex = /(\d{4}-\d{2}-\d{2})\s+@\s+(\d{2}:\d{2}\s+[AP]M)/g;

  // Array to store matched dates and times
  const matches = [];

  // Match dates and times in the HTML content
  let match;
  while ((match = dateTimeRegex.exec(htmlContent)) !== null) {
    matches.push({
      date: match[1],
      time: match[2],
    });
  }

  // Convert matched dates and times to Date objects
  const startTime = new Date(matches[0].date + " " + matches[0].time);
  const endTime = new Date(matches[1].date + " " + matches[1].time);

  return {
    startTime,
    endTime,
  };
}
