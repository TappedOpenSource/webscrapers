// import all scrapers
import type { Scraper } from "@/types";
import JungleRoomScraper from "./jungleroom";
import GoldenPony from "./goldenpony";
import EmberScraper from "./ember";

export const scrapers: Scraper[] = [
  JungleRoomScraper,
  EmberScraper,
  GoldenPony,
];
