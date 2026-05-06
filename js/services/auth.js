import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { auth, db } from "../platform/firebase.js";
import {
  ensureLocalStorageReady,
  exitLocalMode,
  isLocalMode,
  setLocalModeEnabled,
} from "../platform/local-db.js";

const ALLOWED_USERS_COLLECTION = "allowedUsers";

function createAuthError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function getUserEmail(user) {
  const email = String(user?.email ?? "").trim();
  if (!email) {
    throw createAuthError("auth/email-not-found", "Googleアカウントのメールアドレスを取得できませんでした。");
  }
  return email;
}

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  let isReloadingForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (isReloadingForUpdate) return;
    isReloadingForUpdate = true;
    window.location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(new URL("../../service-worker.js", import.meta.url), {
        scope: "../../",
      });
      await registration.update();
    } catch (_error) {
      // SW registration failure is non-fatal.
    }
  });
}

export function onAuthChanged(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function isAllowedUserEmail(email) {
  const normalizedEmail = String(email ?? "").trim();
  if (!normalizedEmail) return false;
  const snapshot = await getDoc(doc(db, ALLOWED_USERS_COLLECTION, normalizedEmail));
  return snapshot.exists();
}

export async function ensureAllowedUser(user) {
  const email = getUserEmail(user);
  const isAllowed = await isAllowedUserEmail(email);
  if (!isAllowed) {
    await signOut(auth);
    throw createAuthError("auth/user-not-allowed", "このアカウントは許可されていません");
  }
  return email;
}

export async function loginWithGoogle() {
  exitLocalMode();
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  const email = await ensureAllowedUser(result.user);
  console.log("Google login:", email);
  return result;
}

export async function logout() {
  if (isLocalMode()) {
    exitLocalMode();
    return null;
  }
  return signOut(auth);
}

export async function enterLocalMode() {
  await ensureLocalStorageReady();
  if (auth.currentUser) {
    await signOut(auth);
  }
  setLocalModeEnabled();
}
