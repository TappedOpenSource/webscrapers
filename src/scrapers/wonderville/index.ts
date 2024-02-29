import type { Scraper } from "../../types";
import { metadata } from "./config";
import { scrape } from "./scraper";

const scraper: Scraper = {
  run: scrape,
  metadata,
};

export default scraper;
