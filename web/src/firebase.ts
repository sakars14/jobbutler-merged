// src/firebase.ts
import { initializeApp } from "firebase/app";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  RecaptchaVerifier,
  signInWithPhoneNumber,
} from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDb20hgXQfea23DMuKqC9N7xaofBLjYGic",
  authDomain: "jobbutler-37587.firebaseapp.com",
  projectId: "jobbutler-37587",
  storageBucket: "jobbutler-37587.firebasestorage.app",
  messagingSenderId: "712242622743",
  appId: "1:712242622743:web:faf84b4c112140b8d3c752",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// Persist session
setPersistence(auth, browserLocalPersistence);

// IMPORTANT: Do NOT connect to the auth emulator here.
// If you previously had connectAuthEmulator(...), remove it.

/** Return a singleton invisible reCAPTCHA verifier (required by the SDK). */
export const getInvisibleVerifier = (containerId = "recaptcha-container") => {
  const w = window as any;
  if (!w.__appVerifier) {
    w.__appVerifier = new RecaptchaVerifier(auth, containerId, { size: "invisible" });
  }
  return w.__appVerifier as RecaptchaVerifier;
};

export const sendOtp = (phoneE164: string, verifier: RecaptchaVerifier) =>
  signInWithPhoneNumber(auth, phoneE164, verifier);
