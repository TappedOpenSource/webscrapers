import { Timestamp } from "firebase-admin/firestore";

export type Option<T> = T | null;

export type Location = {
  placeId: string;
  geohash: string;
  lat: number;
  lng: number;
};

export type ScraperMetadata = {
  id: string;
  name: string;
  url: string;
  sitemap: string;
  location: Location;
};

export type Scraper = {
  run: ({ online }: { online: boolean }) => Promise<void>;
  metadata: ScraperMetadata;
};

export type ScrapedEventData = {
  id: string;
  isMusicEvent: boolean;
  url: string;
  title: string;
  description: string;
  artists: string[];
  ticketPrice: Option<number>;
  advTicketPrice: Option<number>;
  doorTicketPrice: Option<number>;
  startTime: Date;
  endTime: Date;
  flierUrl: Option<string>;
};

export type RunData = {
  id: string;
  startTime: Date;
  endTime: Option<Date>;
  error: Option<string>;
};

export type Booking = {
  id: string;
  scraperInfo: {
    scraperId: string;
    runId: string;
  };
  serviceId: Option<string>;
  name: string;
  note: string;
  requesterId: string;
  requesteeId: string;
  status: string;
  rate: number;
  startTime: Timestamp;
  endTime: Timestamp;
  timestamp: Timestamp;
  flierUrl: Option<string>;
};
