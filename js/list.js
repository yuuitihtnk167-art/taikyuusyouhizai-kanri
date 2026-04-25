import {
  onAuthChanged,
  logout,
  loadItems,
  removeItem,
  calculateAdditionalCostTotal,
  calculateMonthlyCostWithAdditionalCosts,
  formatCurrency,
  getCategoryLabel,
  firebaseErrorMessage,
  registerServiceWorker,
} from "./common.js";

const authStatus = document.getElementById("auth-status");
const authError = document.getElementById("auth-error");
const logoutButton = document.getElementById("logout-button");
const createButton = document.getElementById("create-button");
const itemList = document.getElementById("item-list");

const summaryMonthlyCost = document.getElementById("summary-monthly-cost");
const summaryPurchaseTotal = document.getElementById("summary-purchase-total");
const summaryItemCount = document.getElementById("summary-item-count");

const detailName = document.getElementById("detail-name");
const detailContent = document.getElementById("detail-content");
const detailEditButton = document.getElementById("detail-edit-button");
const detailDeleteButton = document.getElementById("detail-delete-button");

const TIMELINE_MIN_YEAR = 2015;
const TIMELINE_MAX_YEAR = 2055;
const YEAR_WIDTH = 168;
const LABEL_WIDTH = 230;

const state = {
  uid: null,
  items: [],
  selectedItemId: null,
};

function createElement(tagName, className, textContent = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (textContent) element.textContent = textContent;
  return element;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toMonthIndex(date) {
  return date.getFullYear() * 12 + date.getMonth();
}

function formatYearMonthFromIndex(monthIndex) {
  const year = Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  return `${year}/${String(month).padStart(2, "0")}`;
}

function itemStartMonth(item) {
  const purchaseDate = parseDate(item.purchaseDate);
  return purchaseDate ? toMonthIndex(purchaseDate) : TIMELINE_MIN_YEAR * 12;
}

function itemEndMonth(item) {
  return itemStartMonth(item) + Math.max(Number(item.yearsOfUse) || 1, 1) * 12;
}

function resolveTimelineRange(items) {
  let minYear = TIMELINE_MIN_YEAR;
  let maxYear = TIMELINE_MAX_YEAR;

  for (const item of items) {
    minYear = Math.min(minYear, Math.floor(itemStartMonth(item) / 12));
    maxYear = Math.max(maxYear, Math.ceil(itemEndMonth(item) / 12));
  }

  return { minYear, maxYear };
}

function calculateLifecycleProgress(item) {
  const now = new Date();
  const nowMonth = toMonthIndex(now);
  const startMonth = itemStartMonth(item);
  const durationMonths = Math.max(itemEndMonth(item) - startMonth, 1);
  return (nowMonth - startMonth) / durationMonths;
}

function lifecycleStatus(item) {
  if (item.endOfUseDate) return "ended";

  const progress = calculateLifecycleProgress(item);
  if (progress >= 1) return "ended";
  if (progress >= 0.85) return "danger";
  if (progress >= 0.5) return "warning";
  return "normal";
}

function summarizeItems(items) {
  const activeItems = items.filter((item) => !item.endOfUseDate && lifecycleStatus(item) !== "ended");
  const monthlyCostTotal = activeItems.reduce(
    (total, item) => total + calculateMonthlyCostWithAdditionalCosts(item),
    0
  );
  const purchaseTotal = items.reduce((total, item) => total + Number(item.purchasePrice || 0), 0);

  summaryMonthlyCost.textContent = `${formatCurrency(monthlyCostTotal)} /月`;
  summaryPurchaseTotal.textContent = formatCurrency(purchaseTotal);
  summaryItemCount.textContent = `${items.length} 件`;
}

function renderEmptyTimeline() {
  itemList.innerHTML = "";
  const empty = createElement("div", "timeline-empty");
  empty.innerHTML = `
    <strong>登録データがありません</strong>
    <span>家電を登録すると、購入日から耐用年数までのライフサイクル帯を表示します。</span>
  `;
  itemList.appendChild(empty);
}

function renderAxis(grid, minYear, maxYear, positionClass) {
  const axis = createElement("div", `timeline-axis ${positionClass}`);
  const yearCount = maxYear - minYear;

  for (let year = minYear; year <= maxYear; year += 1) {
    const marker = createElement("span", "timeline-year", String(year));
    marker.style.left = `${LABEL_WIDTH + (year - minYear) * YEAR_WIDTH}px`;
    axis.appendChild(marker);
  }

  for (let index = 0; index <= yearCount * 12; index += 1) {
    const tick = createElement("span", index % 12 === 0 ? "timeline-tick major" : "timeline-tick");
    tick.style.left = `${LABEL_WIDTH + (index / 12) * YEAR_WIDTH}px`;
    axis.appendChild(tick);
  }

  grid.appendChild(axis);
}

function renderCurrentLine(grid, minYear, maxYear) {
  const now = new Date();
  const minMonth = minYear * 12;
  const maxMonth = maxYear * 12;
  const nowPosition = toMonthIndex(now) + now.getDate() / 31;

  if (nowPosition < minMonth || nowPosition > maxMonth) return;

  const currentLine = createElement("div", "timeline-current-line");
  currentLine.style.left = `${LABEL_WIDTH + ((nowPosition - minMonth) / 12) * YEAR_WIDTH}px`;
  currentLine.innerHTML = '<span>現在</span>';
  grid.appendChild(currentLine);
}

function renderTimeline(items) {
  itemList.innerHTML = "";
  if (items.length === 0) {
    renderEmptyTimeline();
    return;
  }

  const { minYear, maxYear } = resolveTimelineRange(items);
  const timelineWidth = LABEL_WIDTH + (maxYear - minYear) * YEAR_WIDTH;
  const minMonth = minYear * 12;

  const scroll = createElement("div", "timeline-scroll");
  scroll.tabIndex = 0;
  scroll.setAttribute("aria-label", "ライフサイクル年表。横にスクロールできます。");

  const grid = createElement("div", "timeline-grid");
  grid.style.width = `${timelineWidth}px`;
  grid.style.setProperty("--label-width", `${LABEL_WIDTH}px`);

  renderAxis(grid, minYear, maxYear, "timeline-axis-top");
  renderCurrentLine(grid, minYear, maxYear);

  const rows = createElement("div", "timeline-rows");
  for (const item of items) {
    const startMonth = itemStartMonth(item);
    const endMonth = itemEndMonth(item);
    const status = lifecycleStatus(item);
    const left = LABEL_WIDTH + ((startMonth - minMonth) / 12) * YEAR_WIDTH;
    const width = Math.max(((endMonth - startMonth) / 12) * YEAR_WIDTH, 84);
    const isSelected = item.id === state.selectedItemId;

    const row = createElement("div", "timeline-row");
    const label = createElement("div", "timeline-row-label");
    label.innerHTML = `<span class="status-swatch status-${status}"></span><strong></strong>`;
    label.querySelector("strong").textContent = item.name;

    const band = createElement("button", `lifecycle-band status-${status}`);
    band.type = "button";
    band.dataset.id = item.id;
    band.setAttribute("aria-pressed", String(isSelected));
    band.setAttribute("aria-label", `${item.name}の詳細を表示`);
    band.style.left = `${left}px`;
    band.style.width = `${width}px`;

    const purchaseText = createElement("span", "band-purchase", `${formatYearMonthFromIndex(startMonth)} 購入`);
    const costText = createElement("span", "band-cost", `${formatCurrency(calculateMonthlyCostWithAdditionalCosts(item))} /月`);
    band.append(purchaseText, costText);

    const endLabel = createElement(
      "span",
      `timeline-end-label status-${status}`,
      `${formatYearMonthFromIndex(endMonth)} (${item.yearsOfUse}年)`
    );
    endLabel.style.left = `${left + width + 10}px`;

    row.append(label, band, endLabel);
    rows.appendChild(row);
  }

  grid.appendChild(rows);
  renderAxis(grid, minYear, maxYear, "timeline-axis-bottom");
  scroll.appendChild(grid);
  itemList.appendChild(scroll);
}

function createDetailMetric(label, value) {
  const wrapper = createElement("div", "detail-metric");
  const labelElement = createElement("span", "", label);
  const valueElement = createElement("strong", "", value);
  wrapper.append(labelElement, valueElement);
  return wrapper;
}

function renderDetail(item) {
  if (!item) {
    detailName.textContent = "商品を選択してください";
    detailContent.innerHTML = '<p class="empty">帯をタップすると詳細を表示します。</p>';
    detailEditButton.disabled = true;
    detailDeleteButton.disabled = true;
    return;
  }

  const startMonth = itemStartMonth(item);
  const endMonth = itemEndMonth(item);
  const additionalCostTotal = calculateAdditionalCostTotal(item);

  detailName.textContent = item.name;
  detailContent.innerHTML = "";
  detailContent.append(
    createDetailMetric("分類", getCategoryLabel(item.category)),
    createDetailMetric("型番", item.model || "未入力"),
    createDetailMetric("購入日", item.purchaseDate || "未入力"),
    createDetailMetric("耐用終了予定", formatYearMonthFromIndex(endMonth)),
    createDetailMetric("予定耐用年数", `${item.yearsOfUse} 年`),
    createDetailMetric("購入金額", formatCurrency(item.purchasePrice)),
    createDetailMetric("追加費用", formatCurrency(additionalCostTotal)),
    createDetailMetric("月額コスト", `${formatCurrency(calculateMonthlyCostWithAdditionalCosts(item))} /月`),
    createDetailMetric("ライフサイクル", `${formatYearMonthFromIndex(startMonth)} - ${formatYearMonthFromIndex(endMonth)}`)
  );
  detailEditButton.disabled = false;
  detailDeleteButton.disabled = false;
}

function selectedItem() {
  return state.items.find((item) => item.id === state.selectedItemId) ?? null;
}

function selectItem(itemId) {
  state.selectedItemId = itemId;
  renderTimeline(state.items);
  renderDetail(selectedItem());
}

async function refreshList() {
  state.items = await loadItems(state.uid);
  if (!state.items.some((item) => item.id === state.selectedItemId)) {
    state.selectedItemId = state.items[0]?.id ?? null;
  }
  summarizeItems(state.items);
  renderTimeline(state.items);
  renderDetail(selectedItem());
}

summarizeItems([]);
renderEmptyTimeline();
renderDetail(null);

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

  const band = target.closest(".lifecycle-band");
  if (!(band instanceof HTMLButtonElement)) return;

  selectItem(band.dataset.id ?? "");
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
    state.selectedItemId = null;
    await refreshList();
  } catch (error) {
    authError.textContent = firebaseErrorMessage(error, "削除に失敗しました。");
  } finally {
    detailDeleteButton.disabled = false;
  }
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
