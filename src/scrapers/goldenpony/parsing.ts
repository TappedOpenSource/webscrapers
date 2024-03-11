import { Page } from "puppeteer";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { JsonOutputFunctionsParser } from "langchain/output_parsers";

export function getEventNameFromUrl(url: string) {
  const pathname = new URL(url).pathname;

  // Regular Expression to capture the event name after /events-list/year/month/day
  // It will not match if there's only /events-list with nothing after
  const eventNameRegex = /\/events-list\/\d{4}\/\d{1,2}\/\d{1,2}\/(.+)$/;

  // Apply the regex and return the captured group if matched, otherwise null
  const match = pathname.match(eventNameRegex);

  return match ? match[1] : null;
}

export function parseTicketPrice(desc: string) {
  const pricesRegex = /s*\$\s*(\d+)/g;

  const prices = desc.match(pricesRegex);

  let ticketPrice;
  let doorPrice;
  if (prices) {
    if (prices[1]) {
      doorPrice = parseInt(prices[1].slice(1), 10);
      ticketPrice = parseInt(prices[0].slice(1), 10);
    } else {
      if (prices[0]) {
        ticketPrice = parseInt(prices[0].slice(1), 10);
        doorPrice = ticketPrice;
      }
    }
  }

  return [ticketPrice ?? null, doorPrice ?? null];
}

export async function parseDescription(page: Page): Promise<string | null> {
  return await page.evaluate(() => {
    function getTextContent() {
      let text = "";

      const descriptionContainer = document.querySelector(
        ".eventitem-column-content",
      );
      const descriptionLines = descriptionContainer
        ? descriptionContainer.querySelectorAll("p")
        : null;
      if (descriptionLines) {
        descriptionLines.forEach((line) => {
          let lineText = line.textContent;
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
}

export function parseTimes(startTimeStr: string[], endTimeStr: string[]) {
  const [startTime, endTime] = [startTimeStr, endTimeStr].map(
    (match: string[]) => {
      // Function to convert month name to month index

      const monthNameToIndex: {
        [key: string]: number;
      } = {
        January: 0,
        February: 1,
        March: 2,
        April: 3,
        May: 4,
        June: 5,
        July: 6,
        August: 7,
        September: 8,
        October: 9,
        November: 10,
        December: 11,
      };

      const year = parseInt(match[3]);
      const monthStr: string = match[1];
      const month: number = monthNameToIndex[monthStr];
      const day = parseInt(match[2]);
      const timeStr = match[4];

      // Convert matches to JavaScript Date objects
      const date = new Date(
        year,
        month,
        day,
        monthStr.endsWith("PM")
          ? parseInt(timeStr.split(":")[0]) + 12
          : parseInt(timeStr.split(":")[0]),
        parseInt(timeStr.split(":")[1]),
      );

      return date;
    },
  );

  return {
    startTime,
    endTime,
  };
}

export async function parseArtists(title: string): Promise<string[]> {
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
            "The musicians listed in the title of this event or an empty array if none are found.",
        },
      },
      required: ["artistNames"],
    },
  };

  const llm = new ChatOpenAI({});
  const runnable = llm
    .bind({
      functions: [extractionFunctionSchema],
      function_call: { name: "extractor" },
    })
    .pipe(parser);

  const systemMsg = new SystemMessage(`
    can you parse this string into an array with the names of all the musicians.
    the website this was copied from uses all kind of delimiters such as "&" "W." "w/", "W/" or ","
    but also longer natural language delimiters like "with support from".
    These are mostly Rock, Folk, Punk, Psychedelic, Metal, and Alt Country musicians so short words containing numbers or symbols are not part of the name
    `);
  const msg = new HumanMessage(`
                    the string: "${title}"
                `);
  const res = (await runnable.invoke([systemMsg, msg])) as {
    artistNames?: string[];
  };

  // console.log({ sum: event.summary, res });
  const artistNames = res.artistNames ?? [];
  return artistNames;
}
