import {
  login,
  onAuthChanged,
  enterLocalMode,
  isLocalMode,
  LOCAL_WARNING_DISMISSED_KEY,
  storageGetItem,
  storageSetItem,
  firebaseErrorMessage,
  registerServiceWorker,
} from "./common.js";

const authError = document.getElementById("auth-error");
const emailInput = document.getElementById("auth-email");
const passwordInput = document.getElementById("auth-password");
const loginButton = document.getElementById("login-button");
const localModeButton = document.getElementById("local-mode-button");
const localModeDialog = document.getElementById("local-mode-dialog");
const localModeStartButton = document.getElementById("local-mode-start-button");
const localModeCancelButton = document.getElementById("local-mode-cancel-button");
const hideLocalModeWarningInput = document.getElementById("hide-local-mode-warning");

function setButtonDisabled(button, disabled) {
  if (button) button.disabled = disabled;
}

function setButtonsDisabled(disabled) {
  setButtonDisabled(loginButton, disabled);
  setButtonDisabled(localModeButton, disabled);
}

function getCredentials() {
  return {
    email: emailInput.value.trim(),
    password: passwordInput.value,
  };
}

loginButton.addEventListener("click", async () => {
  authError.textContent = "";
  const { email, password } = getCredentials();
  if (!email || !password) {
    authError.textContent = "メールアドレスとパスワードを入力してください。";
    return;
  }
  try {
    setButtonsDisabled(true);
    await login(email, password);
    window.location.href = "list.html";
  } catch (error) {
    authError.textContent = firebaseErrorMessage(error, "ログインに失敗しました。");
  } finally {
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

onAuthChanged((user) => {
  if (user && !isLocalMode()) {
    window.location.href = "list.html";
  }
});

registerServiceWorker();
