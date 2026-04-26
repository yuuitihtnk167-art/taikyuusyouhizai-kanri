import {
  onAuthChanged,
  logout,
  loadItems,
  removeItem,
  calculateMonthlyCostWithAdditionalCosts,
  formatCurrency,
  CATEGORY_OPTIONS,
  getCategoryLabel,
  isPcManagementItem,
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

function daysInMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function toMonthPosition(date) {
  return toMonthIndex(date) + (date.getDate() - 1) / daysInMonth(date);
}

function addYearsClamped(date, years) {
  const targetYear = date.getFullYear() + years;
  const targetMonth = date.getMonth();
  const targetDay = Math.min(date.getDate(), new Date(targetYear, targetMonth + 1, 0).getDate());
  return new Date(targetYear, targetMonth, targetDay);
}

function formatYearMonthFromIndex(monthIndex) {
  const normalizedMonthIndex = Math.floor(monthIndex);
  const year = Math.floor(normalizedMonthIndex / 12);
  const month = (normalizedMonthIndex % 12) + 1;
  return `${year}/${String(month).padStart(2, "0")}`;
}

function itemStartMonth(item) {
  const purchaseDate = parseDate(item.purchaseDate);
  return purchaseDate ? toMonthPosition(purchaseDate) : TIMELINE_MIN_YEAR * 12;
}

function currentMonthIndex() {
  return toMonthPosition(new Date());
}

function itemPlannedEndMonth(item) {
  const purchaseDate = parseDate(item.purchaseDate);
  const yearsOfUse = Math.max(Number(item.yearsOfUse) || 1, 1);
  if (!purchaseDate) {
    return itemStartMonth(item) + yearsOfUse * 12;
  }
  return toMonthPosition(addYearsClamped(purchaseDate, yearsOfUse));
}

function itemActualEndMonth(item) {
  const endOfUseDate = parseDate(item.endOfUseDate);
  if (endOfUseDate) {
    return Math.max(itemStartMonth(item), toMonthPosition(endOfUseDate));
  }
  return currentMonthIndex();
}

function itemEndMonth(item) {
  if (item.endOfUseDate) {
    return itemActualEndMonth(item);
  }
  return Math.max(itemPlannedEndMonth(item), itemActualEndMonth(item));
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
  return getCategoryLabel(item.category);
}

function categoryOrderIndex(categoryValue) {
  const index = CATEGORY_OPTIONS.findIndex((category) => category.value === categoryValue);
  return index === -1 ? CATEGORY_OPTIONS.length : index;
}

function sortItemsByCategory(items) {
  return [...items].sort((a, b) => {
    const categoryCompare = categoryOrderIndex(a.category) - categoryOrderIndex(b.category);
    if (categoryCompare !== 0) return categoryCompare;

    const dateCompare = String(b.purchaseDate).localeCompare(String(a.purchaseDate));
    if (dateCompare !== 0) return dateCompare;
    return String(a.name).localeCompare(String(b.name), "ja");
  });
}

function calculateLifecycleProgress(item) {
  const now = new Date();
  const nowMonth = toMonthPosition(now);
  const startMonth = itemStartMonth(item);
  const durationMonths = Math.max(itemPlannedEndMonth(item) - startMonth, 1);
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
  const activeItems = items.filter((item) => !item.endOfUseDate);
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
  const currentPosition = currentLinePosition(minYear, maxYear);

  if (currentPosition === null) return;

  const currentLine = createElement("div", "timeline-current-line");
  currentLine.style.left = `${currentPosition}px`;
  currentLine.innerHTML = '<span>現在</span>';
  grid.appendChild(currentLine);
}

function currentLinePosition(minYear, maxYear) {
  const { labelWidth, yearWidth } = timelineLayout();
  const now = new Date();
  const minMonth = minYear * 12;
  const maxMonth = maxYear * 12;
  const nowPosition = toMonthPosition(now);

  if (nowPosition < minMonth || nowPosition > maxMonth) return null;
  return labelWidth + ((nowPosition - minMonth) / 12) * yearWidth;
}

function centerCurrentLine(scroll, minYear, maxYear) {
  const currentPosition = currentLinePosition(minYear, maxYear);
  if (currentPosition === null) return;
  const { labelWidth } = timelineLayout();

  requestAnimationFrame(() => {
    const maxScrollLeft = Math.max(scroll.scrollWidth - scroll.clientWidth, 0);
    const visibleTimelineWidth = Math.max(scroll.clientWidth - labelWidth, 1);
    const targetScrollLeft = currentPosition - labelWidth - visibleTimelineWidth / 2;
    scroll.scrollLeft = Math.min(Math.max(targetScrollLeft, 0), maxScrollLeft);
  });
}

function renderTimeline(items) {
  itemList.innerHTML = "";
  if (items.length === 0) {
    renderEmptyTimeline();
    return;
  }

  const sortedItems = sortItemsByCategory(items);
  const { minYear, maxYear } = resolveTimelineRange(sortedItems);
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
  for (const item of sortedItems) {
    const startMonth = itemStartMonth(item);
    const endMonth = itemEndMonth(item);
    const plannedEndMonth = itemPlannedEndMonth(item);
    const status = lifecycleStatus(item);
    const left = labelWidth + ((startMonth - minMonth) / 12) * yearWidth;
    const width = Math.max(((endMonth - startMonth) / 12) * yearWidth, timelineLayout().isCompact ? 32 : 84);
    const overuseStartPercent = ((plannedEndMonth - startMonth) / Math.max(endMonth - startMonth, 1)) * 100;
    const isOverused = itemActualEndMonth(item) > plannedEndMonth;
    const isSelected = item.id === state.selectedItemId;

    const row = createElement("div", "timeline-row");
    const label = createElement("div", "timeline-row-label");
    label.innerHTML = `<span class="category-swatch category-${item.category}"></span><strong></strong>`;
    label.querySelector("strong").textContent = displayApplianceType(item);

    const band = createElement("button", `lifecycle-band category-${item.category}${isOverused ? " overused" : ""}`);
    band.type = "button";
    band.dataset.id = item.id;
    band.setAttribute("aria-pressed", String(isSelected));
    band.setAttribute("aria-label", `${item.name}の詳細を表示`);
    band.style.left = `${left}px`;
    band.style.width = `${width}px`;
    if (isOverused) {
      band.style.setProperty("--overuse-start", `${Math.min(Math.max(overuseStartPercent, 0), 100)}%`);
    }

    const purchaseText = createElement("span", "band-name", item.name || "商品名未入力");
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
  centerCurrentLine(scroll, minYear, maxYear);
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
  const loadedItems = await loadItems(state.uid);
  state.items = loadedItems.filter((item) => !isPcManagementItem(item));
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
