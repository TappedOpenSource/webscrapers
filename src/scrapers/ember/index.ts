import { Scraper } from "@/types";
import { scrape } from "./scraper";
import { metadata } from "./config";

const scraper: Scraper = {
  scrape,
  metadata,
};

export default scraper;
