import {
  onAuthChanged,
  logout,
  loadItems,
  removeItem,
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

const itemNameDialog = document.getElementById("item-name-dialog");
const dialogItemName = document.getElementById("dialog-item-name");
const dialogItemMeta = document.getElementById("dialog-item-meta");
const dialogEditButton = document.getElementById("dialog-edit-button");
const dialogDeleteButton = document.getElementById("dialog-delete-button");
const dialogCloseButton = document.getElementById("dialog-close-button");

const TIMELINE_MIN_YEAR = 2015;
const TIMELINE_MAX_YEAR = 2055;
const DESKTOP_YEAR_WIDTH = 168;
const DESKTOP_LABEL_WIDTH = 230;
const MOBILE_YEAR_WIDTH = 28;
const MOBILE_LABEL_WIDTH = 72;

const state = {
  uid: null,
  items: [],
  selectedItemId: null,
  resizeTimer: null,
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
  const endOfUseDate = parseDate(item.endOfUseDate);
  if (endOfUseDate) {
    return Math.max(itemStartMonth(item), toMonthIndex(endOfUseDate));
  }
  return itemStartMonth(item) + Math.max(Number(item.yearsOfUse) || 1, 1) * 12;
}

function itemEndLabel(item, endMonth) {
  if (item.endOfUseDate) {
    return `${formatYearMonthFromIndex(endMonth)} (使用終了)`;
  }
  return `${formatYearMonthFromIndex(endMonth)} (${item.yearsOfUse}年)`;
}

function timelineLayout() {
  const isCompact = window.matchMedia("(max-width: 640px)").matches;
  return {
    isCompact,
    labelWidth: isCompact ? MOBILE_LABEL_WIDTH : DESKTOP_LABEL_WIDTH,
    yearWidth: isCompact ? MOBILE_YEAR_WIDTH : DESKTOP_YEAR_WIDTH,
  };
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

function displayApplianceType(item) {
  const text = `${item.name ?? ""} ${item.model ?? ""} ${getCategoryLabel(item.category)}`.toLowerCase();
  if (item.category === "tv") return "テレビ";
  if (item.category === "cooking_appliance") return "調理家電";
  if (item.category === "washing_machine") return "洗濯機";
  if (item.category === "pc" || /pc|パソコン|ノート|デスクトップ|mac|windows/.test(text)) return "パソコン";
  if (/テレビ|tv|有機el|液晶/.test(text)) return "テレビ";
  if (/洗濯|乾燥機|ランドリー/.test(text)) return "洗濯機";
  if (/炊飯|電子レンジ|レンジ|オーブン|トースター|ih|調理|コンロ|ミキサー|ホットプレート/.test(text)) {
    return "調理家電";
  }
  return "その他";
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
  const { isCompact, labelWidth, yearWidth } = timelineLayout();
  const axis = createElement("div", `timeline-axis ${positionClass}`);
  const yearCount = maxYear - minYear;

  for (let year = minYear; year <= maxYear; year += 1) {
    if (isCompact && year % 5 !== 0) continue;
    const marker = createElement("span", "timeline-year", String(year));
    marker.style.left = `${labelWidth + (year - minYear) * yearWidth}px`;
    axis.appendChild(marker);
  }

  for (let index = 0; index <= yearCount * 12; index += 1) {
    const tick = createElement("span", index % 12 === 0 ? "timeline-tick major" : "timeline-tick");
    tick.style.left = `${labelWidth + (index / 12) * yearWidth}px`;
    axis.appendChild(tick);
  }

  grid.appendChild(axis);
}

function renderCurrentLine(grid, minYear, maxYear) {
  const { labelWidth, yearWidth } = timelineLayout();
  const now = new Date();
  const minMonth = minYear * 12;
  const maxMonth = maxYear * 12;
  const nowPosition = toMonthIndex(now) + now.getDate() / 31;

  if (nowPosition < minMonth || nowPosition > maxMonth) return;

  const currentLine = createElement("div", "timeline-current-line");
  currentLine.style.left = `${labelWidth + ((nowPosition - minMonth) / 12) * yearWidth}px`;
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
  const { labelWidth, yearWidth } = timelineLayout();
  const timelineWidth = labelWidth + (maxYear - minYear) * yearWidth;
  const minMonth = minYear * 12;

  const scroll = createElement("div", "timeline-scroll");
  scroll.tabIndex = 0;
  scroll.setAttribute("aria-label", "ライフサイクル年表。横にスクロールできます。");

  const grid = createElement("div", "timeline-grid");
  grid.style.width = `${timelineWidth}px`;
  grid.style.setProperty("--label-width", `${labelWidth}px`);
  grid.style.setProperty("--year-width", `${yearWidth}px`);

  renderAxis(grid, minYear, maxYear, "timeline-axis-top");
  renderCurrentLine(grid, minYear, maxYear);

  const rows = createElement("div", "timeline-rows");
  for (const item of items) {
    const startMonth = itemStartMonth(item);
    const endMonth = itemEndMonth(item);
    const status = lifecycleStatus(item);
    const left = labelWidth + ((startMonth - minMonth) / 12) * yearWidth;
    const width = Math.max(((endMonth - startMonth) / 12) * yearWidth, timelineLayout().isCompact ? 32 : 84);
    const isSelected = item.id === state.selectedItemId;

    const row = createElement("div", "timeline-row");
    const label = createElement("div", "timeline-row-label");
    label.innerHTML = `<span class="status-swatch status-${status}"></span><strong></strong>`;
    label.querySelector("strong").textContent = displayApplianceType(item);

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
      itemEndLabel(item, endMonth)
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

function selectedItem() {
  return state.items.find((item) => item.id === state.selectedItemId) ?? null;
}

function selectItem(itemId) {
  state.selectedItemId = itemId;
  renderTimeline(state.items);
  const item = selectedItem();
  openItemNameDialog(item);
}

function openItemNameDialog(item) {
  if (!item || !itemNameDialog) return;
  dialogItemName.textContent = item.name || "商品名未入力";
  dialogItemMeta.textContent = `${displayApplianceType(item)} / ${formatCurrency(
    calculateMonthlyCostWithAdditionalCosts(item)
  )} /月`;
  itemNameDialog.showModal();
}

async function refreshList() {
  state.items = await loadItems(state.uid);
  if (!state.items.some((item) => item.id === state.selectedItemId)) {
    state.selectedItemId = state.items[0]?.id ?? null;
  }
  summarizeItems(state.items);
  renderTimeline(state.items);
}

summarizeItems([]);
renderEmptyTimeline();

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

dialogEditButton.addEventListener("click", () => {
  const item = selectedItem();
  if (!item) return;
  window.location.href = `form.html?id=${encodeURIComponent(item.id)}`;
});

dialogDeleteButton.addEventListener("click", async () => {
  const item = selectedItem();
  if (!item || !state.uid) return;
  const shouldDelete = confirm(`「${item.name}」を削除しますか？`);
  if (!shouldDelete) return;

  authError.textContent = "";
  try {
    dialogDeleteButton.disabled = true;
    await removeItem(state.uid, item.id);
    itemNameDialog.close();
    state.selectedItemId = null;
    await refreshList();
  } catch (error) {
    authError.textContent = firebaseErrorMessage(error, "削除に失敗しました。");
  } finally {
    dialogDeleteButton.disabled = false;
  }
});

dialogCloseButton.addEventListener("click", () => {
  itemNameDialog.close();
});

itemNameDialog.addEventListener("click", (event) => {
  if (event.target === itemNameDialog) itemNameDialog.close();
});

window.addEventListener("resize", () => {
  window.clearTimeout(state.resizeTimer);
  state.resizeTimer = window.setTimeout(() => {
    renderTimeline(state.items);
  }, 120);
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
