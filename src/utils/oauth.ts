import { google } from "googleapis";

import path from "path";
const KEYFILEPATH = path.join(__dirname, "../../google-calendar-service-account.json");
const scopes = ["https://www.googleapis.com/auth/calendar.readonly"];
const authClient = new google.auth.GoogleAuth({
  keyFile: KEYFILEPATH,
  scopes: scopes
});



export { authClient }