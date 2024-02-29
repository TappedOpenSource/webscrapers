import { fcm } from "../firebase";
import { tokensRef } from "./database";

const foundersIds: string[] = [
    "8yYVxpQ7cURSzNfBsaBGF7A7kkv2", // Johannes
    "n4zIL6bOuPTqRC3dtsl6gyEBPQl1", // Ilias
];

async function notifyFounders({ title, body }: {
    title: string;
    body: string;
}) {
    foundersIds.map(async (founderId) => {
        const tokensSnap = await tokensRef
            .doc(founderId)
            .collection("tokens")
            .get();


        const tokens: string[] = tokensSnap.docs.map((snap) => snap.id);
        await Promise.all(tokens.map(async (token) => {
            try {
                await fcm.send({
                    token,
                    notification: {
                        title,
                        body,
                    },
                });
            } catch (e: any) {
                console.log(`[!!!] error sending notification to token: ${token} - ${e.message}`);
                await tokensRef.doc(founderId).collection("tokens").doc(token).delete();
            }
        }));
    });
}

export async function notifyOnScrapeSuccess({ runId, eventCount }: {
    runId: string;
    eventCount: number;
}) {
    if (eventCount === 0) {
        await notifyFounders({
            title: "jungle room scrape success",
            body: `no new events in scrape run ${runId}`,
        });
    }

    await notifyFounders({
        title: "jungle room scrape success",
        body: `scrape run ${runId} succeeded with ${eventCount} new events`,
    });
}

export async function notifyOnScrapeFailure({ error }: {
    error: string;
}) {
    await notifyFounders({
        title: "jungle room scrape failure",
        body: `most recent scrape failed with error: ${error}`,
    });
}