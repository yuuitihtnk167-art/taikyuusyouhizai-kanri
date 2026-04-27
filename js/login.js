import { login, signup, onAuthChanged, enterLocalMode, isLocalMode, firebaseErrorMessage, registerServiceWorker } from "./common.js";

const authError = document.getElementById("auth-error");
const emailInput = document.getElementById("auth-email");
const passwordInput = document.getElementById("auth-password");
const loginButton = document.getElementById("login-button");
const signupButton = document.getElementById("signup-button");
const localModeButton = document.getElementById("local-mode-button");

function setButtonsDisabled(disabled) {
  loginButton.disabled = disabled;
  signupButton.disabled = disabled;
  localModeButton.disabled = disabled;
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

signupButton.addEventListener("click", async () => {
  authError.textContent = "";
  const { email, password } = getCredentials();
  if (!email || !password) {
    authError.textContent = "メールアドレスとパスワードを入力してください。";
    return;
  }
  if (password.length < 6) {
    authError.textContent = "パスワードは6文字以上で入力してください。";
    return;
  }
  try {
    setButtonsDisabled(true);
    await signup(email, password);
    window.location.href = "list.html";
  } catch (error) {
    authError.textContent = firebaseErrorMessage(error, "新規登録に失敗しました。");
  } finally {
    setButtonsDisabled(false);
  }
});

localModeButton.addEventListener("click", async () => {
  authError.textContent = "";
  try {
    setButtonsDisabled(true);
    await enterLocalMode();
    window.location.href = "list.html";
  } catch (error) {
    authError.textContent = error?.message || "ローカル保存を開始できません。";
  } finally {
    setButtonsDisabled(false);
  }
});

onAuthChanged((user) => {
  if (user && !isLocalMode()) {
    window.location.href = "list.html";
  }
});

registerServiceWorker();
