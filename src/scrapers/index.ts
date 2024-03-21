// import all scrapers
import type { Scraper } from "../types";
import JungleRoomScraper from "./jungleroom";
import GoldenPony from "./goldenpony";
import EmberScraper from "./ember";
import WondervilleScraper from "./wonderville";
import PearlStreetScraper from "./pearlstreet";
import SongbyrdScraper from "./songbyrd";

export const scrapers: Scraper[] = [
  JungleRoomScraper,
  EmberScraper,
  GoldenPony,
  WondervilleScraper,
  PearlStreetScraper,
  SongbyrdScraper,
];
