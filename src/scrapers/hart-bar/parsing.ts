import type { Page } from "puppeteer";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { JsonOutputFunctionsParser } from "langchain/output_parsers";

import { authClient } from "../../utils/oauth";
import { google, calendar_v3 } from "googleapis";
import { GaxiosResponse } from "gaxios";

function formatTime(time : string) {
  const timeRegex = /^(\d{1,2})\s*(\d{2})?(?:\s*(am|pm))?$/i;
  const match = time.match(timeRegex);
  if (!match) {
    console.error("Invalid time format");
    return time; 
  }
  
  const hour = parseInt(match[1]);
  const minute = match[2] || "00"; 
  const period = match[3].toLowerCase();
  

  let formattedTime = hour % 12 + ":" + minute + " " + period.toUpperCase();
  if (formattedTime.charAt(0) === "0") {
    formattedTime = formattedTime.slice(1);
  }
  return formattedTime;
}

function parseTime(timeString : string) {
  const [time, period] = timeString.split(" ");
  const [hours, minutes] = time.split(":");
  let intHours = parseInt(hours);
  const intMinutes = parseInt(minutes);
  
  if (period === "PM" && intHours < 12) intHours += 12;
  if (period === "AM" && intHours === 12) intHours = 0;

  // Use a fixed date for all times to ensure only the time part affects the comparison
  const date = new Date(2000, 0, 1, intHours, intMinutes);
  return date;
}


function updateHour(time: string, date: Date) {
  const timeRegex =/(\d{1,2}):(\d{2})\s+(PM|AM)/i; 
  
  // Extract hour, time of day (AM/PM) from the start time string
  const match = time.match(timeRegex);
  if (!match) {
    console.error("Invalid start time format");
    return;
  }
  
  let hour = parseInt(match[1]);
  const minute = parseInt(match[2])
  const period = match[3].toLowerCase();
  
  if (period === "pm" && hour !== 12) {
    hour += 12;
  } else if (period === "am" && hour === 12) {
    hour = 0;
  }
  
  const newDate = new Date(date);
  newDate.setHours(hour, minute, 0, 0);

  if (newDate < date) {
    newDate.setDate(newDate.getDate() + 1);
  }
  return newDate;
}

export async function getBookingsFromCalendar(calendarId: string) {

  const calendar = google.calendar({ version: "v3", auth: authClient });
  let pageToken: string | undefined;
  let eventsCount = 0;
  let allEvents: calendar_v3.Schema$Event[] = [];
  const pageSize = 250;

  do {
    const response: GaxiosResponse<calendar_v3.Schema$Events> = await calendar.events.list({
      calendarId,
      timeMin: new Date("2021-1-1").toISOString(),
      timeMax: new Date("2024-12-30").toISOString(),
      maxResults: pageSize,
      pageToken: pageToken,
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = response.data.items;
    if (!events || events.length === 0) {
      console.log("[!!!] No upcoming events found.");
      break;
    }

    eventsCount += events.length;
    console.log(`--------------- Fetched ${events.length} events`);
    if (response.data.items) {
      const newEvents = response.data.items?.filter(event => 
        !allEvents.some(e => e.id === event.id)) || [];

      allEvents = allEvents.concat(newEvents);
    }
  

    pageToken = response.data.nextPageToken ?? undefined;
    
  } while (pageToken);

  console.log(`[+] Event total: ${eventsCount}`);
  return allEvents
}

export function getEventNameFromUrl(url: string) {
  const pathname = new URL(url).pathname;

  // Exclude private events from bookings

  if (pathname.includes("private")) {
    return null;
  }

  // Regular Expression to capture the event name after /events/
  // It will not match if there's only /events with nothing after
  const eventNameRegex = /\/events\/(.+)$/;

  // Apply the regex and return the captured group if matched, otherwise null
  const match = pathname.match(eventNameRegex);

  return match ? match[1] : null;
}

export function parseTicketPrice(priceText: string) {
  let ticketPrice;
  let doorPrice;

  const priceRegex = /\$\d+/g;
  const price = priceText.match(priceRegex) ? priceText.match(priceRegex) : [];
  if (price && price[0]) {
    ticketPrice = Number(price[0].trim().slice(1));
    doorPrice = price[1] ? Number(price[1].trim().slice(1)) : ticketPrice;
  }
  return [ticketPrice ?? null, doorPrice ?? null];
}

export function parseDescription(description: string | null, ) {
  if (description) {
    const plainDescription = description.replace(/<[^>]*>/g, " ");
    return plainDescription;
  } else {
    return null;
  }
}

//   // Regular Expression to capture the event name after /calendar/
//   // It will not match if there's only /calendar with nothing after
//   const eventNameRegex = /^\/event\/(.+)$/;

//   // Apply the regex and return the captured group if matched, otherwise null
//   const match = pathname.match(eventNameRegex);
//   return match ? match[1] : null;
// }

export async function parseDates(description: string, gStartTime: Date , gEndTime: Date) {
  
  // Regular expression pattern to match date and time
  const dateTimeRegex =
    /\s*(\d{1,3}\w{1,2})\s+-\s+(\w*)\s+?(\w*)/gms;

  // Array to store matched dates and times
  const startTimes: string[] = [];
  const endTimes: string[] = [];
  // Match dates and times in the HTML content
  let match;
  while ((match = dateTimeRegex.exec(description)) !== null) {
    let wasDate = false;
    for (let i = 1; i < match.length; i++) {
      const m = match[i];
      const isDate = m.includes("pm") || m.includes("am") || m.includes("PM") || m.includes("AM");
        
      if (wasDate && isDate) {
        // Must be a time range and this is the end
        endTimes.push(m);
      } else {
        if (isDate) {
          // Must be a start date
          startTimes.push(m);
        }
      }
        
      if (isDate) {
        wasDate = true;
      } else {
        wasDate = false;
      }
    }

  } 

  
  const minStartTime = startTimes[0] ? formatTime(startTimes[0]) : null
  const maxStartTime = startTimes.slice(-1)[0] ? formatTime(startTimes.slice(-1)[0]) : null
  const maxEndTime = endTimes.slice(-1)[0] ? formatTime(endTimes.slice(-1)[0]) : null

  const gStartHour = gStartTime.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true });
  const gEndHour = gEndTime.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", hour12: true });

  let startTime = gStartTime
  
  if (minStartTime) {
    const minComparator = parseTime(minStartTime)
    const gStartComparator = parseTime(gStartHour)
    if (minComparator < gStartComparator) {
      startTime = updateHour(minStartTime, gStartTime) ?? gStartTime;
    }
  }

  let endTime = gEndTime
  if (maxEndTime) {
    const maxComparator = parseTime(maxEndTime)
    const gEndComparator = parseTime(gEndHour)
    if (maxComparator > gEndComparator) {
      endTime = updateHour(maxEndTime, gEndTime) ?? gEndTime;
    }
    
  }
  if (startTime.getTime() === endTime.getTime() || endTime < startTime || startTimes.length > 2) {
    
    if (maxStartTime && minStartTime != maxStartTime) {
      // Add an arbitrary amount of time for the end of the event (like 1 hour)
      const splitMaxStart = maxStartTime.split(":")
      const updatedEndHour = String(Number(splitMaxStart[0]) + 1) + ":" + splitMaxStart[1]
      endTime = updateHour(updatedEndHour, gEndTime) ?? gEndTime

    }
  }

  // Convert matched dates and times to Date objects

  return [
    startTime,
    endTime,
  ];
}

export async function parseArtists(
  title: string,
  description: string,
): Promise<{ artists: string[]; isMusicEvent: boolean }> {
  const parser = new JsonOutputFunctionsParser();
  const extractionFunctionSchema = {
    name: "extractor",
    description: "Extracts fields from the input.",
    parameters: {
      type: "object",
      properties: {
        artistNames: {
          type: "array",
          items: {
            type: "string",
          },
          description:
            "The performers for this event or an empty array if there aren't any",
        },
        isMusicEvent: {
          type: "boolean",
          description: "Whether the event is a music event or not.",
        },
      },
      required: ["artistNames", "isMusicEvent"],
    },
  };

  const llm = new ChatOpenAI({
    modelName: "gpt-3.5-turbo",
  });
  const runnable = llm
    .bind({
      functions: [extractionFunctionSchema],
      function_call: { name: "extractor" },
    })
    .pipe(parser);

  const systemMsg = new SystemMessage(`
    your job is to extract information about an event at the cocktail bar "Hart Bar" from the title and description'
    None of these are performers names are "Hart Bar", "Bar", "Open", "Open House", "Dance Party", "Open Mic", etc.
    if you find that the event doesn't to be an event related to music (e.g. a comedy show), set the isMusicEvent to false.'
    `);
  const msg = new HumanMessage(`
                    the title: "${title}"
                    the description: "${description}"
                `);
  const res = (await runnable.invoke([systemMsg, msg])) as {
    artistNames?: string[];
    isMusicEvent?: boolean;
  };

  // console.log({ sum: event.summary, res });
  const artistNames = res.artistNames ?? [];
  const isMusicEvent = res.isMusicEvent ?? false;

  return { artists: artistNames, isMusicEvent };
}

export const sanitizeUsername = (artistName: string) => {
  // Convert name to lowercase
  let username = artistName.toLowerCase();

  // Replace spaces with a hyphen
  username = username.replace(/\s+/g, "_");

  // Remove disallowed characters (only keep letters, numbers, hyphens, and underscores)
  username = username.replace(/[^a-z0-9_]/g, "");

  return username;
};

export async function getFlierUrl(page: Page) {
  try {
    return await page.evaluate(() => {
      const img = document.querySelector(".event-detail-banner-image");
      if (!img) {
        return null;
      }

      const src = img.getAttribute("src");
      return src;
    });
  } catch (error) {
    console.error("[-] error getting flier url", error);
    return null;
  }
}
