import { Timestamp } from "firebase-admin/firestore";
import { v4 as uuidv4 } from "uuid";
import type {
  Booking,
  ScrapedEventData,
  RunData,
  ScraperMetadata,
  Location,
} from "../types";
import { auth, db } from "../firebase";
import { sanitizeUsername } from "../utils/sanitize";
import { chatGpt } from "../utils/ai";

export const usersRef = db.collection("users");
export const bookingsRef = db.collection("bookings");
const reviewsRef = db.collection("reviews");
export const rawScrappingRef = db.collection("rawScrapeData");
export const tokensRef = db.collection("tokens");

export async function startScrapeRun(
  scraper: ScraperMetadata,
): Promise<string> {
  // update scraper document
  const userId = scraper.id;
  await rawScrappingRef.doc(userId).set({
    ...scraper,
    lastScrapeStart: Timestamp.now(),
  });

  // add new run
  const docRef = await rawScrappingRef
    .doc(userId)
    .collection("scrapeRuns")
    .add({
      ...scraper,
      startTime: Timestamp.now(),
    });

  return docRef.id;
}

export async function endScrapeRun(
  scraper: ScraperMetadata,
  scrapeRunId: string,
  { error }: { error: string | null },
) {
  const userId = scraper.id;

  // update scraper document
  await rawScrappingRef.doc(userId).set({
    ...scraper,
    lastScrapeEnd: Timestamp.now(),
  });

  // update last run
  await rawScrappingRef
    .doc(userId)
    .collection("scrapeRuns")
    .doc(scrapeRunId)
    .update({
      endTime: Timestamp.now(),
      error: error,
    });
}

export async function saveScrapeResult(
  scraper: ScraperMetadata,
  runId: string,
  data: ScrapedEventData,
): Promise<void> {
  console.log(`[+] saving scrape result for ${runId} - ${data.title}`);

  const userId = scraper.id;

  await rawScrappingRef
    .doc(userId)
    .collection("scrapeRuns")
    .doc(runId)
    .collection("scrapeResults")
    .add({
      ...data,
    });

  await createBookingsFromEvent(scraper, runId, data);

  return;
}

export async function getLatestRun(
  scraper: ScraperMetadata,
): Promise<RunData | null> {
  const userId = scraper.id;
  const querySnap = await rawScrappingRef
    .doc(userId)
    .collection("scrapeRuns")
    .where("error", "==", null)
    .orderBy("startTime", "desc")
    .limit(1)
    .get();

  if (querySnap.empty) {
    return null;
  }

  const latestRun = querySnap.docs[0];
  const runData = latestRun.data() as {
    id: string;
    startTime: Timestamp;
    endTime?: Timestamp | null;
  };

  const startTime = runData.startTime.toDate();
  const endTime = runData.endTime?.toDate() ?? null;

  return {
    id: latestRun.id,
    startTime,
    endTime,
    error: null,
  };
}

export async function getOrCreateArtist({
  location,
  performerName,
  bio,
}: {
  location: Location;
  performerName: string;
  bio?: string;
}): Promise<string | null> {
  console.log(`[+] checking if performer exists: ${performerName}`);
  const artistUsername = sanitizeUsername(performerName);
  const artistSnap = await usersRef
    .where("username", "==", artistUsername)
    .limit(1)
    .get();
  if (!artistSnap.empty) {
    console.log(`[+] artist already exists: ${performerName}`);
    return artistSnap.docs[0].id;
  }

  try {
    const artistEmail = `${artistUsername}-${
      Math.floor(Math.random() * 100) // random number between 1 and 100
    }@tapped.ai`;
    const userRecord = await auth.createUser({
      email: artistEmail,
      password: uuidv4(),
    });
    const uid = userRecord.uid;
    const artistObject: {
      id: string;
      email: string;
      timestamp: Timestamp;
      username: string;
      artistName: string;
      bio: string;
      occupations: string[];
      profilePicture: string | null;
      unclaimed: true;
      location: Location;
      performerInfo: {
        genres: string[];
        label: "None";
        rating: number;
        reviewCount: number;
      };
      deleted: false;
    } = {
      location,
      id: uid,
      email: artistEmail,
      timestamp: Timestamp.now(),
      username: artistUsername,
      artistName: performerName,
      bio: bio ?? "",
      occupations: [],
      profilePicture: null,
      performerInfo: {
        label: "None",
        genres: ["edm"],
        rating: 5.0,
        reviewCount: 1,
      },
      unclaimed: true,
      deleted: false,
    };

    // console.log({ artistObject });
    await usersRef.doc(uid).set(artistObject);
    console.log(`[+] created artist: ${artistObject.artistName}`);
    return uid;
  } catch (e) {
    console.error(`[!!!] failed to create artist: ${performerName} - ${e}`);
    return null;
  }
}

export async function createBookingsFromEvent(
  scraper: ScraperMetadata,
  runId: string,
  data: ScrapedEventData,
) {
  const userId = scraper.id;
  const location = scraper.location;
  data.artists.map(async (artistName) => {
    const id = uuidv4();
    const requesterId = userId;
    const requesteeId = await getOrCreateArtist({
      location,
      performerName: artistName,
      bio: data.description,
    });

    if (requesteeId === null) {
      return;
    }

    const booking: Booking = {
      ...location,
      scraperInfo: {
        scraperId: userId,
        runId,
      },
      id,
      name: data.title,
      note: data.description,
      serviceId: null,
      requesterId,
      requesteeId,
      status: "confirmed",
      rate: 0,
      startTime: Timestamp.fromDate(data.startTime),
      endTime: Timestamp.fromDate(data.endTime),
      timestamp: Timestamp.now(),
      flierUrl: data.flierUrl,
    };

    await bookingsRef.doc(booking.id).set(booking);
    console.log(`[+] created booking: ${booking.name}`);

    const bookingStartTime = booking.startTime.toDate();
    if (bookingStartTime.getTime() < Date.now()) {
      console.log(`[+] creating reviews for booking: ${booking.name}`);
      await createReviewsForBooking({
        bookingId: booking.id,
        bookerId: booking.requesterId,
        performerId: booking.requesteeId,
      });
    }
  });
}

export const createReviewsForBooking = async ({
  bookingId,
  performerId,
  bookerId,
}: {
  bookingId: string;
  performerId: string;
  bookerId: string;
}) => {
  const performerSnap = await usersRef.doc(performerId).get();
  if (!performerSnap.exists) {
    console.error(`performer does not exist: ${performerId}`);
    return;
  }
  const performer = performerSnap.data()!;
  const performerName = performer.artistName ?? performer.username;

  const bookerSnap = await usersRef.doc(bookerId).get();
  if (!bookerSnap.exists) {
    console.error(`booker does not exist: ${bookerId}`);
    return;
  }
  const booker = bookerSnap.data()!;
  const bookerName = booker.artistName ?? booker.username;

  const performerReviewText = await chatGpt(
    `imagine you're a venue that just recently booked a musician, named ${performerName} to perform at your venue. you want to leave a very positive review for the musician. what would you say in one or two sentences?`,
    { temperature: 0.4, model: "gpt-3.5-turbo" },
  );
  const bookerReviewText = await chatGpt(
    `image you're a musician who just recently performed at a venue, called ${bookerName}. you want to leave a very positive review for the venue. what would you say in one or two sentences?`,
    { temperature: 0.4, model: "gpt-3.5-turbo" },
  );
  const performerReview: {
    id: string;
    bookerId: string;
    performerId: string;
    bookingId: string;
    timestamp: Timestamp;
    overallRating: number;
    overallReview: string;
    type: "performer";
  } = {
    id: uuidv4(),
    bookingId,
    performerId,
    bookerId,
    overallRating: 5,
    overallReview: performerReviewText,
    timestamp: Timestamp.now(),
    type: "performer",
  };
  const bookerReview: {
    id: string;
    bookerId: string;
    performerId: string;
    bookingId: string;
    timestamp: Timestamp;
    overallRating: number;
    overallReview: string;
    type: "booker";
  } = {
    id: uuidv4(),
    bookingId,
    performerId,
    bookerId,
    overallRating: 5,
    overallReview: bookerReviewText,
    timestamp: Timestamp.now(),
    type: "booker",
  };

  await Promise.all([
    reviewsRef
      .doc(performerId)
      .collection("performerReviews")
      .doc(performerReview.id)
      .set(performerReview),
    reviewsRef
      .doc(bookerId)
      .collection("bookerReviews")
      .doc(bookerReview.id)
      .set(bookerReview),
  ]);
};