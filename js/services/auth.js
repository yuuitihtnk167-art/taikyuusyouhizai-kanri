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
const VERSION_UPGRADE_MESSAGE = [
  "入力中の内容が保存されていません。",
  "バージョンアップすると入力内容が消える可能性があります。",
  "先に保存してください。",
].join("\n");
const PROCESSING_MESSAGE = "処理中です。完了後にバージョンアップしてください。";

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

function pageHasBlockingProcess() {
  return document.body?.dataset.versionUpgradeBusy === "true";
}

function createVersionUpgradeButton() {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost-button version-upgrade-button";
  button.textContent = "バージョンアップ";
  button.hidden = true;
  return button;
}

function mountVersionUpgradeButton(button) {
  const dashboardActions = document.querySelector(".dashboard-title-actions");
  if (dashboardActions) {
    dashboardActions.prepend(button);
    return;
  }

  const settingsHeader = document.querySelector(".settings-header");
  if (settingsHeader) {
    const backButton = settingsHeader.querySelector("#back-button");
    if (backButton) {
      backButton.before(button);
    } else {
      settingsHeader.append(button);
    }
    return;
  }

  const header = document.querySelector(".app-header");
  const title = header?.querySelector("h1");
  if (!header || !title) return;

  const titleRow = document.createElement("div");
  titleRow.className = "app-header-title-row";
  title.before(titleRow);
  titleRow.append(title, button);
}

function confirmVersionUpgradeWithDialog() {
  if (typeof HTMLDialogElement === "undefined") {
    return Promise.resolve(window.confirm(VERSION_UPGRADE_MESSAGE));
  }

  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "version-upgrade-dialog";

    const card = document.createElement("article");
    card.className = "version-upgrade-dialog-card";

    const message = document.createElement("p");
    message.textContent = VERSION_UPGRADE_MESSAGE;

    const actions = document.createElement("div");
    actions.className = "dialog-actions";

    const cancelButton = document.createElement("button");
    cancelButton.type = "button";
    cancelButton.className = "ghost-button";
    cancelButton.textContent = "キャンセル";

    const upgradeButton = document.createElement("button");
    upgradeButton.type = "button";
    upgradeButton.className = "primary-button";
    upgradeButton.textContent = "バージョンアップする";

    actions.append(cancelButton, upgradeButton);
    card.append(message, actions);
    dialog.appendChild(card);

    let shouldUpgrade = false;
    cancelButton.addEventListener("click", () => dialog.close());
    upgradeButton.addEventListener("click", () => {
      shouldUpgrade = true;
      dialog.close();
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(shouldUpgrade);
    }, { once: true });

    document.body.appendChild(dialog);
    dialog.showModal();
    cancelButton.focus();
  });
}

export function registerServiceWorker(options = {}) {
  if (!("serviceWorker" in navigator)) return;
  const isFormDirty = typeof options.isFormDirty === "function" ? options.isFormDirty : () => false;
  const isBusy = typeof options.isBusy === "function" ? options.isBusy : () => false;
  const upgradeButton = createVersionUpgradeButton();
  let waitingWorker = null;
  let isReloadingForUpdate = false;
  let shouldReloadOnControllerChange = false;

  mountVersionUpgradeButton(upgradeButton);

  function showUpgradeButton(worker) {
    waitingWorker = worker;
    upgradeButton.hidden = false;
  }

  async function requestVersionUpgrade() {
    if (!waitingWorker) return;
    if (isBusy() || pageHasBlockingProcess()) {
      window.alert(PROCESSING_MESSAGE);
      return;
    }
    if (isFormDirty()) {
      const shouldUpgrade = await confirmVersionUpgradeWithDialog();
      if (!shouldUpgrade) return;
    }
    upgradeButton.disabled = true;
    shouldReloadOnControllerChange = true;
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  }

  upgradeButton.addEventListener("click", requestVersionUpgrade);

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!shouldReloadOnControllerChange) return;
    if (isReloadingForUpdate) return;
    isReloadingForUpdate = true;
    window.location.reload();
  });

  window.addEventListener("load", async () => {
    try {
      const registration = await navigator.serviceWorker.register(new URL("../../service-worker.js", import.meta.url), {
        scope: "../../",
      });
      if (registration.waiting) {
        showUpgradeButton(registration.waiting);
      }
      registration.addEventListener("updatefound", () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;

        installingWorker.addEventListener("statechange", () => {
          if (installingWorker.state === "installed" && navigator.serviceWorker.controller) {
            showUpgradeButton(installingWorker);
          }
        });
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
