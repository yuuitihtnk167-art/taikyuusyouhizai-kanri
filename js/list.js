import {
  onAuthChanged,
  logout,
  loadItems,
  calculateMonthlyCost,
  calculateTotalMonthlyCost,
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
const detailCloseButton = document.getElementById("detail-close-button");

const state = {
  uid: null,
  items: [],
};

function renderList(items) {
  itemList.innerHTML = "";
  if (items.length === 0) {
    itemList.innerHTML = '<div class="empty">まだ登録がありません。「新規登録」から追加してください。</div>';
    return;
  }

  for (const item of items) {
    const card = document.createElement("article");
    card.className = "item-card";
    card.dataset.id = item.id;

    card.innerHTML = `
      <div class="item-header">
        <h3 class="item-name">
          <button type="button" class="item-name-button" data-action="open-name" data-id="${item.id}">
            ${escapeHtml(item.name)}
          </button>
        </h3>
      </div>
      <p class="item-meta">型番: ${escapeHtml(item.model)} / 購入日: ${escapeHtml(item.purchaseDate)}</p>
      <div class="costs">
        <div class="cost-row">
          <span class="cost-label">月額コスト</span>
          <span class="cost-value">${formatCurrency(calculateMonthlyCost(item))}</span>
        </div>
        <div class="cost-row">
          <span class="cost-label">総月額コスト</span>
          <span class="cost-value">${formatCurrency(calculateTotalMonthlyCost(item))}</span>
        </div>
      </div>
      <p class="item-meta">購入価格: ${formatCurrency(item.purchasePrice)}</p>
      <p class="item-meta">使用年数: ${item.yearsOfUse}年</p>
      <p class="item-meta">月間ランニングコスト: ${formatCurrency(item.monthlyRunningCost)}</p>
    `;
    itemList.appendChild(card);
  }
}

function openDetail(item) {
  detailName.textContent = item.name;
  detailDialog.showModal();
}

async function refreshList() {
  state.items = await loadItems(state.uid);
  renderList(state.items);
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
  const nameButton = target.closest(".item-name-button");
  if (!nameButton) return;
  const id = nameButton.dataset.id;
  if (!id) return;
  const item = state.items.find((x) => x.id === id);
  if (item) openDetail(item);
});

detailCloseButton.addEventListener("click", () => {
  detailDialog.close();
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
