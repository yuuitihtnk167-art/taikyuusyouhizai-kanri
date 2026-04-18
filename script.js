import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  setDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAVfS2GVebf5rEhrF9iQo79xtnpOqPkpCE",
  authDomain: "taikyuusyouhizai-kanri.firebaseapp.com",
  projectId: "taikyuusyouhizai-kanri",
  storageBucket: "taikyuusyouhizai-kanri.firebasestorage.app",
  messagingSenderId: "580176190013",
  appId: "1:580176190013:web:e4c213e42645ac10f5e854",
  measurementId: "G-NRYNZS8E9R",
};

const FIRESTORE_COLLECTION = "durableGoodsItems";

const state = {
  items: [],
  editingId: null,
  db: null,
  auth: null,
  currentUser: null,
};

const appContent = document.getElementById("app-content");
const authStatus = document.getElementById("auth-status");
const authFormError = document.getElementById("auth-error");
const authEmailInput = document.getElementById("auth-email");
const authPasswordInput = document.getElementById("auth-password");
const loginButton = document.getElementById("login-button");
const signupButton = document.getElementById("signup-button");
const logoutButton = document.getElementById("logout-button");

const form = document.getElementById("item-form");
const itemIdInput = document.getElementById("item-id");
const nameInput = document.getElementById("name");
const modelInput = document.getElementById("model");
const purchaseDateInput = document.getElementById("purchase-date");
const purchasePriceInput = document.getElementById("purchase-price");
const yearsOfUseInput = document.getElementById("years-of-use");
const monthlyRunningCostInput = document.getElementById("monthly-running-cost");
const formError = document.getElementById("form-error");
const formMode = document.getElementById("form-mode");
const submitButton = document.getElementById("submit-button");
const cancelButton = document.getElementById("cancel-button");
const itemList = document.getElementById("item-list");
const detailDialog = document.getElementById("detail-dialog");
const detailName = document.getElementById("detail-name");
const detailMeta = document.getElementById("detail-meta");
const detailMonthly = document.getElementById("detail-monthly");
const detailTotal = document.getElementById("detail-total");
const detailPrice = document.getElementById("detail-price");
const detailYears = document.getElementById("detail-years");
const detailRunning = document.getElementById("detail-running");
const detailEditButton = document.getElementById("detail-edit-button");
const detailDeleteButton = document.getElementById("detail-delete-button");
const detailCloseButton = document.getElementById("detail-close-button");

function hasValidFirebaseConfig() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.messagingSenderId && firebaseConfig.appId);
}

function initFirebase() {
  if (!hasValidFirebaseConfig()) {
    throw new Error("Firebase設定値が不足しています。script.jsのfirebaseConfigを確認してください。");
  }
  const app = initializeApp(firebaseConfig);
  return {
    db: getFirestore(app),
    auth: getAuth(app),
  };
}

function userItemsCollectionRef() {
  if (!state.currentUser?.uid) {
    throw new Error("ログインが必要です。");
  }
  return collection(state.db, "users", state.currentUser.uid, FIRESTORE_COLLECTION);
}

function userItemDocRef(itemId) {
  if (!state.currentUser?.uid) {
    throw new Error("ログインが必要です。");
  }
  return doc(state.db, "users", state.currentUser.uid, FIRESTORE_COLLECTION, itemId);
}

async function loadItems() {
  const snapshot = await getDocs(userItemsCollectionRef());
  const items = [];
  snapshot.forEach((documentSnapshot) => {
    const data = documentSnapshot.data();
    items.push({
      id: documentSnapshot.id,
      name: data.name ?? "",
      model: data.model ?? "",
      purchaseDate: data.purchaseDate ?? "",
      purchasePrice: Number(data.purchasePrice ?? 0),
      yearsOfUse: Number(data.yearsOfUse ?? 0),
      monthlyRunningCost: Number(data.monthlyRunningCost ?? 0),
      createdAt: data.createdAt ?? null,
      updatedAt: data.updatedAt ?? null,
    });
  });

  items.sort((a, b) => {
    const aTime = Number(a.updatedAt?.seconds ?? 0);
    const bTime = Number(b.updatedAt?.seconds ?? 0);
    return bTime - aTime;
  });

  return items;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value);
}

function calculateMonthlyCost(item) {
  return item.purchasePrice / (item.yearsOfUse * 12);
}

function calculateTotalMonthlyCost(item) {
  return calculateMonthlyCost(item) + item.monthlyRunningCost;
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function validateItem(item) {
  if (!item.name.trim()) return "商品名を入力してください。";
  if (!item.model.trim()) return "型番を入力してください。";
  if (!item.purchaseDate) return "購入日を入力してください。";
  if (!Number.isFinite(item.purchasePrice) || item.purchasePrice < 0) {
    return "購入価格は0以上の数値で入力してください。";
  }
  if (!Number.isFinite(item.yearsOfUse) || item.yearsOfUse <= 0) {
    return "使用年数は1以上の数値で入力してください。";
  }
  if (!Number.isFinite(item.monthlyRunningCost) || item.monthlyRunningCost < 0) {
    return "月間ランニングコストは0以上の数値で入力してください。";
  }
  return null;
}

function getFormData() {
  return {
    id: itemIdInput.value || createId(),
    name: nameInput.value.trim(),
    model: modelInput.value.trim(),
    purchaseDate: purchaseDateInput.value,
    purchasePrice: Number(purchasePriceInput.value),
    yearsOfUse: Number(yearsOfUseInput.value),
    monthlyRunningCost: Number(monthlyRunningCostInput.value),
  };
}

function renderList(items) {
  itemList.innerHTML = "";
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "まだ登録がありません。フォームから追加してください。";
    itemList.appendChild(empty);
    return;
  }

  for (const item of items) {
    const card = document.createElement("article");
    card.className = "item-card";

    const monthlyCost = calculateMonthlyCost(item);
    const totalMonthlyCost = calculateTotalMonthlyCost(item);

    card.innerHTML = `
      <div class="item-header">
        <h3 class="item-name">${escapeHtml(item.name)}</h3>
      </div>
      <p class="item-meta">購入日: ${escapeHtml(item.purchaseDate)}</p>
      <div class="costs">
        <div class="cost-row">
          <span class="cost-label">月額コスト</span>
          <span class="cost-value">${formatCurrency(monthlyCost)}</span>
        </div>
      </div>
    `;
    card.dataset.id = item.id;
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", `${item.name}の詳細を開く`);

    itemList.appendChild(card);
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function toFirebaseErrorMessage(error, fallback) {
  if (!error) return fallback;
  const code = typeof error === "object" && "code" in error ? error.code : "";
  const message = typeof error === "object" && "message" in error ? error.message : "";

  if (code === "permission-denied") {
    return "権限エラー（permission-denied）。Firestoreルールを確認してください。";
  }
  if (code === "auth/invalid-credential") {
    return "メールアドレスまたはパスワードが正しくありません。";
  }
  if (code === "auth/email-already-in-use") {
    return "そのメールアドレスは既に登録されています。";
  }
  if (code === "auth/weak-password") {
    return "パスワードが弱すぎます。6文字以上を使用してください。";
  }
  if (code === "auth/invalid-email") {
    return "メールアドレスの形式が正しくありません。";
  }
  if (code === "unavailable") {
    return "Firebase接続エラー（unavailable）。ネットワークを確認してください。";
  }
  if (code) return `${fallback} (${code})`;
  if (typeof message === "string" && message.trim()) return `${fallback} (${message})`;
  return fallback;
}

function setAuthButtonsDisabled(disabled) {
  loginButton.disabled = disabled;
  signupButton.disabled = disabled;
}

function resetForm() {
  form.reset();
  itemIdInput.value = "";
  state.editingId = null;
  formMode.textContent = "現在: 新規登録";
  submitButton.textContent = "登録する";
  cancelButton.hidden = true;
  formError.textContent = "";
}

function startEdit(item) {
  state.editingId = item.id;
  itemIdInput.value = item.id;
  nameInput.value = item.name;
  modelInput.value = item.model;
  purchaseDateInput.value = item.purchaseDate;
  purchasePriceInput.value = item.purchasePrice;
  yearsOfUseInput.value = item.yearsOfUse;
  monthlyRunningCostInput.value = item.monthlyRunningCost;
  formMode.textContent = "現在: 編集中";
  submitButton.textContent = "更新する";
  cancelButton.hidden = false;
  formError.textContent = "";
}

async function upsertItem(newItem) {
  const existingIndex = state.items.findIndex((item) => item.id === newItem.id);
  const payload = {
    name: newItem.name,
    model: newItem.model,
    purchaseDate: newItem.purchaseDate,
    purchasePrice: newItem.purchasePrice,
    yearsOfUse: newItem.yearsOfUse,
    monthlyRunningCost: newItem.monthlyRunningCost,
    updatedAt: serverTimestamp(),
  };
  if (existingIndex < 0) {
    payload.createdAt = serverTimestamp();
  }

  await setDoc(userItemDocRef(newItem.id), payload, { merge: true });
  state.items = await loadItems();
  renderList(state.items);
}

async function deleteItem(id) {
  await deleteDoc(userItemDocRef(id));
  state.items = state.items.filter((item) => item.id !== id);
  renderList(state.items);
  if (state.editingId === id) resetForm();
}

function handleAuthState(user) {
  state.currentUser = user;
  resetForm();
  formError.textContent = "";
  authFormError.textContent = "";

  if (!user) {
    authStatus.textContent = "状態: 未ログイン";
    appContent.hidden = true;
    logoutButton.hidden = true;
    state.items = [];
    renderList(state.items);
    if (detailDialog.open) {
      detailDialog.close();
    }
    return;
  }

  authStatus.textContent = `状態: ログイン中 (${user.email ?? "メール未設定"})`;
  appContent.hidden = false;
  logoutButton.hidden = false;
}

function openDetail(item) {
  const monthlyCost = calculateMonthlyCost(item);
  const totalMonthlyCost = calculateTotalMonthlyCost(item);
  detailName.textContent = item.name;
  detailMeta.textContent = `型番: ${item.model} / 購入日: ${item.purchaseDate}`;
  detailMonthly.textContent = formatCurrency(monthlyCost);
  detailTotal.textContent = formatCurrency(totalMonthlyCost);
  detailPrice.textContent = `購入価格: ${formatCurrency(item.purchasePrice)}`;
  detailYears.textContent = `使用年数: ${item.yearsOfUse}年`;
  detailRunning.textContent = `月間ランニングコスト: ${formatCurrency(item.monthlyRunningCost)}`;
  detailEditButton.dataset.id = item.id;
  detailDeleteButton.dataset.id = item.id;
  detailDialog.showModal();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const item = getFormData();
  const error = validateItem(item);
  if (error) {
    formError.textContent = error;
    return;
  }

  try {
    submitButton.disabled = true;
    await upsertItem(item);
    resetForm();
  } catch (authError) {
    formError.textContent = toFirebaseErrorMessage(authError, "保存に失敗しました。");
  } finally {
    submitButton.disabled = false;
  }
});

cancelButton.addEventListener("click", () => {
  resetForm();
});

itemList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const card = target.closest(".item-card");
  if (!card) return;

  const id = card.dataset.id;
  if (!id) return;
  const item = state.items.find((x) => x.id === id);
  if (item) openDetail(item);
});

itemList.addEventListener("keydown", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  const card = target.closest(".item-card");
  if (!card) return;
  event.preventDefault();
  const id = card.dataset.id;
  if (!id) return;
  const item = state.items.find((x) => x.id === id);
  if (item) openDetail(item);
});

detailEditButton.addEventListener("click", () => {
  const id = detailEditButton.dataset.id;
  if (!id) return;
  const item = state.items.find((x) => x.id === id);
  if (!item) return;
  startEdit(item);
  detailDialog.close();
  form.scrollIntoView({ behavior: "smooth", block: "start" });
});

detailDeleteButton.addEventListener("click", async () => {
  const id = detailDeleteButton.dataset.id;
  if (!id) return;
  const confirmed = window.confirm("このデータを削除しますか？");
  if (!confirmed) return;
  try {
    await deleteItem(id);
    detailDialog.close();
  } catch (deleteError) {
    formError.textContent = toFirebaseErrorMessage(deleteError, "削除に失敗しました。");
  }
});

detailCloseButton.addEventListener("click", () => {
  detailDialog.close();
});

loginButton.addEventListener("click", async () => {
  authFormError.textContent = "";
  const email = authEmailInput.value.trim();
  const password = authPasswordInput.value;
  if (!email || !password) {
    authFormError.textContent = "メールアドレスとパスワードを入力してください。";
    return;
  }

  try {
    setAuthButtonsDisabled(true);
    await signInWithEmailAndPassword(state.auth, email, password);
  } catch (authError) {
    authFormError.textContent = toFirebaseErrorMessage(authError, "ログインに失敗しました。");
  } finally {
    setAuthButtonsDisabled(false);
  }
});

signupButton.addEventListener("click", async () => {
  authFormError.textContent = "";
  const email = authEmailInput.value.trim();
  const password = authPasswordInput.value;
  if (!email || !password) {
    authFormError.textContent = "メールアドレスとパスワードを入力してください。";
    return;
  }
  if (password.length < 6) {
    authFormError.textContent = "パスワードは6文字以上で入力してください。";
    return;
  }

  try {
    setAuthButtonsDisabled(true);
    await createUserWithEmailAndPassword(state.auth, email, password);
  } catch (authError) {
    authFormError.textContent = toFirebaseErrorMessage(authError, "新規登録に失敗しました。");
  } finally {
    setAuthButtonsDisabled(false);
  }
});

logoutButton.addEventListener("click", async () => {
  authFormError.textContent = "";
  try {
    await signOut(state.auth);
  } catch (authError) {
    authFormError.textContent = toFirebaseErrorMessage(authError, "ログアウトに失敗しました。");
  }
});

async function init() {
  try {
    const initialized = initFirebase();
    state.db = initialized.db;
    state.auth = initialized.auth;

    onAuthStateChanged(state.auth, async (user) => {
      handleAuthState(user);
      if (!user) return;

      try {
        state.items = await loadItems();
        renderList(state.items);
      } catch (loadError) {
        const message = toFirebaseErrorMessage(loadError, "データ取得に失敗しました。");
        itemList.innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
      }
    });
  } catch (error) {
    const message = toFirebaseErrorMessage(error, "初期化に失敗しました。");
    itemList.innerHTML = `<div class="empty">${escapeHtml(message)}</div>`;
  }
}

await init();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("/service-worker.js");
    } catch (_error) {
      // Service worker registration failure is non-fatal.
    }
  });
}
