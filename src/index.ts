import { configDotenv } from "dotenv";
import { startServer } from "./server";

function main() {
  configDotenv({
    path: ".env",
  });

  startServer().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

main();
