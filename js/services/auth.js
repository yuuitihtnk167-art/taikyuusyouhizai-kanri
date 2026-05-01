import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { auth } from "../platform/firebase.js";
import {
  ensureLocalStorageReady,
  exitLocalMode,
  isLocalMode,
  setLocalModeEnabled,
} from "../platform/local-db.js";

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

export async function login(email, password) {
  exitLocalMode();
  return signInWithEmailAndPassword(auth, email, password);
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
