import { login, signup, onAuthChanged, firebaseErrorMessage, registerServiceWorker } from "./common.js";

const authStatus = document.getElementById("auth-status");
const authError = document.getElementById("auth-error");
const emailInput = document.getElementById("auth-email");
const passwordInput = document.getElementById("auth-password");
const loginButton = document.getElementById("login-button");
const signupButton = document.getElementById("signup-button");

function setButtonsDisabled(disabled) {
  loginButton.disabled = disabled;
  signupButton.disabled = disabled;
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

onAuthChanged((user) => {
  if (user) {
    window.location.href = "list.html";
    return;
  }
  authStatus.textContent = "状態: 未ログイン";
});

registerServiceWorker();
