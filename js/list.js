import {
  onAuthChanged,
  logout,
  loadItems,
  removeItem,
  calculateMonthlyCost,
  calculateAdditionalCostTotal,
  calculateMonthlyCostWithAdditionalCosts,
  calculateUsageMonths,
  calculateActualMonthlyCost,
  formatCurrency,
  escapeHtml,
  firebaseErrorMessage,
  registerServiceWorker,
} from "./common.js";

const authStatus = document.getElementById("auth-status");
const authError = document.getElementById("auth-error");
const logoutButton = document.getElementById("logout-button");
const createButton = document.getElementById("create-button");
const itemList = document.getElementById("item-list");

const detailDialog = document.getElementById("detail-dialog");
const detailName = document.getElementById("detail-name");
const detailEditButton = document.getElementById("detail-edit-button");
const detailDeleteButton = document.getElementById("detail-delete-button");
const detailCloseButton = document.getElementById("detail-close-button");

const state = {
  uid: null,
  items: [],
  selectedItemId: null,
};

function renderList(items) {
  itemList.innerHTML = "";
  if (items.length === 0) {
    itemList.innerHTML = '<div class="empty">まだ登録がありません。「新規登録」から追加してください。</div>';
    return;
  }

  for (const item of items) {
    const usageMonths = calculateUsageMonths(item.purchaseDate, item.endOfUseDate);
    const additionalCostTotal = calculateAdditionalCostTotal(item);
    const actualMonthlyCost = calculateActualMonthlyCost(item);
    const usageMonthsText = usageMonths ? `${usageMonths}か月` : "未入力";
    const actualCostText = actualMonthlyCost !== null ? formatCurrency(actualMonthlyCost) : "未入力";

    const card = document.createElement("article");
    card.className = "item-card";
    card.dataset.id = item.id;
    card.tabIndex = 0;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `${item.name}の操作を開く`);

    card.innerHTML = `
      <div class="item-header">
        <h3 class="item-name">
          <button type="button" class="item-name-button" data-id="${item.id}">
            ${escapeHtml(item.name)}
          </button>
        </h3>
      </div>
      <p class="item-meta">型番: ${escapeHtml(item.model)} / 購入日: ${escapeHtml(item.purchaseDate)}</p>
      <div class="costs">
        <div class="cost-row">
          <span class="cost-label">本体のみの月額コスト</span>
          <span class="cost-value">${formatCurrency(calculateMonthlyCost(item))}</span>
        </div>
        <div class="cost-row">
          <span class="cost-label">追加費用込みの月額コスト</span>
          <span class="cost-value">${formatCurrency(calculateMonthlyCostWithAdditionalCosts(item))}</span>
        </div>
        <div class="cost-row">
          <span class="cost-label">実質月額コスト</span>
          <span class="cost-value">${actualCostText}</span>
        </div>
      </div>
      <p class="item-meta">購入価格: ${formatCurrency(item.purchasePrice)}</p>
      <p class="item-meta">追加費用合計: ${formatCurrency(additionalCostTotal)}</p>
      <p class="item-meta">使用年数: ${item.yearsOfUse}年</p>
      <p class="item-meta">使用終了日: ${item.endOfUseDate ? escapeHtml(item.endOfUseDate) : "未入力"}</p>
      <p class="item-meta">使用月数: ${usageMonthsText}</p>
    `;
    itemList.appendChild(card);
  }
}

function selectedItem() {
  return state.items.find((item) => item.id === state.selectedItemId) ?? null;
}

function openDetail(item) {
  state.selectedItemId = item.id;
  detailName.textContent = item.name;
  detailDialog.showModal();
}

async function refreshList() {
  state.items = await loadItems(state.uid);
  renderList(state.items);
}

function findCardItem(target) {
  const card = target.closest(".item-card");
  if (!card) return null;
  const id = card.dataset.id;
  if (!id) return null;
  return state.items.find((item) => item.id === id) ?? null;
}

createButton.addEventListener("click", () => {
  window.location.href = "form.html";
});

logoutButton.addEventListener("click", async () => {
  authError.textContent = "";
  try {
    await logout();
    window.location.href = "login.html";
  } catch (error) {
    authError.textContent = firebaseErrorMessage(error, "ログアウトに失敗しました。");
  }
});

itemList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const item = findCardItem(target);
  if (item) openDetail(item);
});

itemList.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  const item = findCardItem(target);
  if (!item) return;
  event.preventDefault();
  openDetail(item);
});

detailEditButton.addEventListener("click", () => {
  const item = selectedItem();
  if (!item) return;
  window.location.href = `form.html?id=${encodeURIComponent(item.id)}`;
});

detailDeleteButton.addEventListener("click", async () => {
  const item = selectedItem();
  if (!item || !state.uid) return;
  const shouldDelete = confirm(`「${item.name}」を削除しますか？`);
  if (!shouldDelete) return;

  authError.textContent = "";
  try {
    detailDeleteButton.disabled = true;
    await removeItem(state.uid, item.id);
    detailDialog.close();
    state.selectedItemId = null;
    await refreshList();
  } catch (error) {
    authError.textContent = firebaseErrorMessage(error, "削除に失敗しました。");
  } finally {
    detailDeleteButton.disabled = false;
  }
});

detailCloseButton.addEventListener("click", () => {
  detailDialog.close();
});

detailDialog.addEventListener("close", () => {
  state.selectedItemId = null;
});

onAuthChanged(async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }
  state.uid = user.uid;
  authStatus.textContent = `状態: ログイン中 (${user.email ?? "メール未設定"})`;
  try {
    await refreshList();
  } catch (error) {
    authError.textContent = firebaseErrorMessage(error, "データ取得に失敗しました。");
  }
});

registerServiceWorker();
