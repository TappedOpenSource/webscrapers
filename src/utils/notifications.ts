import { URL } from "../firebase";

export async function notifyOnScrapeSuccess({
  runId,
  eventCount,
}: {
  runId: string;
  eventCount: number;
}) {
  if (eventCount === 0) {
    await slackNotification({
      text: `no new events in scrape run ${runId} - ${new Date()}`,
    });
  }

  await slackNotification({
    text: `scrape run ${runId} succeeded with ${eventCount} new events - ${new Date()}`,
  });
}

export async function notifyOnScrapeFailure({ error }: { error: string }) {
  await slackNotification({
    text: `most recent scrape failed with error: ${error} - ${new Date()}`,
  });
}

interface SlackMessage {
    text: string;
  }
  
  async function slackNotification(message: SlackMessage) {
    try {
      const response = await fetch(URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
      });
  
      if (response.ok) {
        console.log("Notification sent to Slack successfully");
      } else {
        throw new Error("Slack notification failed to send");
      }
    } catch (error) {
      console.error(error);
    }
  }