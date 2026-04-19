import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  doc,
  deleteField,
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

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const ITEMS_COLLECTION = "durableGoodsItems";
export const DEFAULT_CATEGORY = "other";
export const CATEGORY_OPTIONS = [
  { value: "home_appliance", label: "家電" },
  { value: "car", label: "自動車" },
  { value: "smartphone", label: "スマホ" },
  { value: "pc", label: "パソコン" },
  { value: "other", label: "その他" },
];

export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register(new URL("../service-worker.js", import.meta.url), {
        scope: "../",
      });
    } catch (_error) {
      // SW registration failure is non-fatal.
    }
  });
}

export function onAuthChanged(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function login(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export async function signup(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}

export async function logout() {
  return signOut(auth);
}

export function formatCurrency(value) {
  return new Intl.NumberFormat("ja-JP", {
    style: "currency",
    currency: "JPY",
    maximumFractionDigits: 0,
  }).format(value);
}

export function normalizeCategory(value) {
  const normalizedValue = String(value ?? "");
  return CATEGORY_OPTIONS.some((category) => category.value === normalizedValue)
    ? normalizedValue
    : DEFAULT_CATEGORY;
}

export function getCategoryLabel(value) {
  const normalizedValue = normalizeCategory(value);
  return CATEGORY_OPTIONS.find((category) => category.value === normalizedValue)?.label ?? "その他";
}

export function calculateMonthlyCost(item) {
  return item.purchasePrice / (item.yearsOfUse * 12);
}

export function normalizeAdditionalCosts(value) {
  if (!Array.isArray(value)) return [];
  return value.map((cost) => ({
    id: cost?.id || createId(),
    amount: Number(cost?.amount ?? 0),
    memo: String(cost?.memo ?? ""),
  }));
}

export function calculateAdditionalCostTotal(item) {
  return normalizeAdditionalCosts(item.additionalCosts).reduce((total, cost) => {
    if (!Number.isFinite(cost.amount)) return total;
    return total + cost.amount;
  }, 0);
}

export function calculateMonthlyCostWithAdditionalCosts(item) {
  return (item.purchasePrice + calculateAdditionalCostTotal(item)) / (item.yearsOfUse * 12);
}

export function calculateUsageMonths(purchaseDate, endOfUseDate) {
  if (!purchaseDate || !endOfUseDate) return null;
  const startDate = new Date(`${purchaseDate}T00:00:00`);
  const endDate = new Date(`${endOfUseDate}T00:00:00`);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  if (endDate < startDate) return 0;

  let months =
    (endDate.getFullYear() - startDate.getFullYear()) * 12 +
    (endDate.getMonth() - startDate.getMonth());
  if (endDate.getDate() < startDate.getDate()) months -= 1;
  return Math.max(months, 1);
}

export function calculateActualMonthlyCost(item) {
  const usageMonths = calculateUsageMonths(item.purchaseDate, item.endOfUseDate);
  if (!usageMonths) return null;
  return (item.purchasePrice + calculateAdditionalCostTotal(item)) / usageMonths;
}

export function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
}

function userItemsCollectionRef(uid) {
  return collection(db, "users", uid, ITEMS_COLLECTION);
}

function userItemDocRef(uid, itemId) {
  return doc(db, "users", uid, ITEMS_COLLECTION, itemId);
}

export async function loadItems(uid) {
  const snapshot = await getDocs(userItemsCollectionRef(uid));
  const items = [];
  snapshot.forEach((documentSnapshot) => {
    const data = documentSnapshot.data();
    items.push({
      id: documentSnapshot.id,
      name: data.name ?? "",
      model: data.model ?? "",
      category: normalizeCategory(data.category),
      purchaseDate: data.purchaseDate ?? "",
      purchasePrice: Number(data.purchasePrice ?? 0),
      yearsOfUse: Number(data.yearsOfUse ?? 0),
      endOfUseDate: data.endOfUseDate ?? "",
      additionalCosts: normalizeAdditionalCosts(data.additionalCosts),
      createdAt: data.createdAt ?? null,
      updatedAt: data.updatedAt ?? null,
    });
  });
  items.sort((a, b) => {
    const dateCompare = String(b.purchaseDate).localeCompare(String(a.purchaseDate));
    if (dateCompare !== 0) return dateCompare;
    return Number(b.updatedAt?.seconds ?? 0) - Number(a.updatedAt?.seconds ?? 0);
  });
  return items;
}

export async function loadItem(uid, itemId) {
  const snapshot = await getDoc(userItemDocRef(uid, itemId));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  return {
    id: snapshot.id,
    name: data.name ?? "",
    model: data.model ?? "",
    category: normalizeCategory(data.category),
    purchaseDate: data.purchaseDate ?? "",
    purchasePrice: Number(data.purchasePrice ?? 0),
    yearsOfUse: Number(data.yearsOfUse ?? 0),
    endOfUseDate: data.endOfUseDate ?? "",
    additionalCosts: normalizeAdditionalCosts(data.additionalCosts),
  };
}

export async function saveItem(uid, item) {
  const payload = {
    name: item.name,
    model: item.model,
    category: normalizeCategory(item.category),
    purchaseDate: item.purchaseDate,
    purchasePrice: item.purchasePrice,
    yearsOfUse: item.yearsOfUse,
    endOfUseDate: item.endOfUseDate,
    additionalCosts: normalizeAdditionalCosts(item.additionalCosts),
    updatedAt: serverTimestamp(),
  };
  if (item.isUpdate) payload.monthlyRunningCost = deleteField();
  if (!item.id) item.id = createId();
  if (!item.isUpdate) payload.createdAt = serverTimestamp();
  await setDoc(userItemDocRef(uid, item.id), payload, { merge: true });
}

export async function removeItem(uid, itemId) {
  await deleteDoc(userItemDocRef(uid, itemId));
}

export function validateItem(item) {
  if (!item.name.trim()) return "商品名を入力してください。";
  if (!item.model.trim()) return "型番を入力してください。";
  if (normalizeCategory(item.category) !== item.category) return "分類を選択してください。";
  if (!item.purchaseDate) return "購入日を入力してください。";
  if (!Number.isFinite(item.purchasePrice) || item.purchasePrice < 0) return "購入価格は0以上で入力してください。";
  if (!Number.isFinite(item.yearsOfUse) || item.yearsOfUse <= 0) return "使用年数は1以上で入力してください。";
  if (item.endOfUseDate && calculateUsageMonths(item.purchaseDate, item.endOfUseDate) === 0) {
    return "使用終了日は購入日以降の日付を入力してください。";
  }
  for (const cost of normalizeAdditionalCosts(item.additionalCosts)) {
    if (!Number.isFinite(cost.amount) || cost.amount < 0) {
      return "追加費用の金額は0以上で入力してください。";
    }
  }
  return null;
}

export function firebaseErrorMessage(error, fallback) {
  const code = typeof error === "object" && error && "code" in error ? error.code : "";
  if (code === "permission-denied") return "権限エラー（permission-denied）です。Firestoreルールを確認してください。";
  if (code === "auth/invalid-credential") return "メールアドレスまたはパスワードが正しくありません。";
  if (code === "auth/email-already-in-use") return "そのメールアドレスは既に登録されています。";
  if (code === "auth/weak-password") return "パスワードは6文字以上で入力してください。";
  if (code === "auth/invalid-email") return "メールアドレスの形式が正しくありません。";
  if (code === "unavailable") return "Firebase接続エラー（unavailable）です。ネットワークを確認してください。";
  return fallback;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
