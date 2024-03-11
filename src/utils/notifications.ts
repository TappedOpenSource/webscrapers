import { SLACK_WEBHOOK_URL } from "../firebase";

export async function notifyOnScrapeSuccess({
  runId,
  eventCount,
}: {
  runId: string;
  eventCount: number;
}) {
  if (eventCount === 0) {
    await slackNotification({
      message: `no new events in scrape run ${runId} - ${new Date()}`,
    });
  }

  await slackNotification({
    message: `scrape run ${runId} succeeded with ${eventCount} new events - ${new Date()}`,
  });
}

export async function notifyOnScrapeFailure({ error }: { error: string }) {
  await slackNotification({
    message: `most recent scrape failed with error: ${error} - ${new Date()}`,
  });
}

async function slackNotification({ message }: { message: string }) {
  try {
    const response = await fetch(SLACK_WEBHOOK_URL, {
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
