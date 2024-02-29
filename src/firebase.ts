import { initializeApp, cert, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { getStorage } from "firebase-admin/storage";

const production = process.env.NODE_ENV === "production";

const credential = production
  ? applicationDefault()
  : cert(require("../credentials.json"));

const app = initializeApp({
  projectId: "in-the-loop-306520",
  credential,
});
const auth = getAuth(app);
const db = getFirestore(app);
const fcm = getMessaging(app);
const storage = getStorage(app);

export const projectId = app.options.projectId;

export const isOnline = ["true", "TRUE"].includes(
  process.env["ONLINE"] ?? "false",
);
export const openaiApiKey = process.env["OPENAI_API_KEY"] ?? "";

export { auth, db, fcm, storage };