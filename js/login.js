import {
  LOCAL_WARNING_DISMISSED_KEY,
  storageGetItem,
  storageSetItem,
  firebaseErrorMessage,
} from "./common.js";
import { isLocalMode } from "./platform/local-db.js";
import {
  ensureAllowedUser,
  enterLocalMode,
  loginWithGoogle,
  onAuthChanged,
  registerServiceWorker,
} from "./services/auth.js";

const authError = document.getElementById("auth-error");
const googleLoginButton = document.getElementById("google-login-button");
const localModeButton = document.getElementById("local-mode-button");
const localModeDialog = document.getElementById("local-mode-dialog");
const localModeStartButton = document.getElementById("local-mode-start-button");
const localModeCancelButton = document.getElementById("local-mode-cancel-button");
const hideLocalModeWarningInput = document.getElementById("hide-local-mode-warning");
let isLoginActionPending = false;

function setButtonDisabled(button, disabled) {
  if (button) button.disabled = disabled;
}

function setButtonsDisabled(disabled) {
  setButtonDisabled(googleLoginButton, disabled);
  setButtonDisabled(localModeButton, disabled);
}

googleLoginButton?.addEventListener("click", async () => {
  authError.textContent = "";
  try {
    isLoginActionPending = true;
    setButtonsDisabled(true);
    await loginWithGoogle();
    window.location.href = "list.html";
  } catch (error) {
    authError.textContent = firebaseErrorMessage(error, "Googleログインに失敗しました。");
  } finally {
    isLoginActionPending = false;
    setButtonsDisabled(false);
  }
});

function shouldShowLocalModeWarning() {
  return storageGetItem(LOCAL_WARNING_DISMISSED_KEY) !== "true";
}

async function startLocalMode() {
  authError.textContent = "";
  try {
    setButtonsDisabled(true);
    if (hideLocalModeWarningInput?.checked) {
      storageSetItem(LOCAL_WARNING_DISMISSED_KEY, "true");
    }
    await enterLocalMode();
    window.location.href = "list.html";
  } catch (error) {
    authError.textContent = error?.message || "ローカル保存を開始できません。";
  } finally {
    setButtonsDisabled(false);
  }
}

localModeButton?.addEventListener("click", async () => {
  if (!shouldShowLocalModeWarning() || !localModeDialog) {
    await startLocalMode();
    return;
  }

  if (hideLocalModeWarningInput) hideLocalModeWarningInput.checked = false;
  localModeDialog.showModal();
});

localModeStartButton?.addEventListener("click", async () => {
  localModeDialog?.close();
  await startLocalMode();
});

localModeCancelButton?.addEventListener("click", () => {
  localModeDialog?.close();
});

onAuthChanged(async (user) => {
  if (user && !isLocalMode() && !isLoginActionPending) {
    try {
      setButtonsDisabled(true);
      await ensureAllowedUser(user);
    } catch (error) {
      authError.textContent = firebaseErrorMessage(error, "ログイン状態の確認に失敗しました。");
      setButtonsDisabled(false);
      return;
    }
    window.location.href = "list.html";
  }
});

registerServiceWorker();
