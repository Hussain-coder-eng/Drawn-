import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, browserSessionPersistence, setPersistence } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import jsonConfig from "../firebase-applet-config.json";

// Prefer VITE_FIREBASE_* env vars so .env overrides the bundled JSON config.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || jsonConfig.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || jsonConfig.authDomain,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || jsonConfig.projectId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || jsonConfig.appId,
  storageBucket: jsonConfig.storageBucket,
  messagingSenderId: jsonConfig.messagingSenderId,
};

const firestoreDatabaseId =
  import.meta.env.VITE_FIRESTORE_DATABASE_ID || jsonConfig.firestoreDatabaseId;

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Set persistence to browser session
setPersistence(auth, browserSessionPersistence).catch((error) => {
  console.error("Error setting session persistence:", error);
});

export const db = getFirestore(app, firestoreDatabaseId);
export const googleProvider = new GoogleAuthProvider();
