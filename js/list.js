import {
  onAuthChanged,
  logout,
  loadItems,
  removeItem,
  calculateMonthlyCost,
  calculateMonthlyCostWithAdditionalCosts,
  formatCurrency,
  CATEGORY_OPTIONS,
  getCategoryLabel,
  isPcManagementItem,
  isLocalMode,
  firebaseErrorMessage,
  registerServiceWorker,
} from "./common.js";

const authError = document.getElementById("auth-error");
const logoutButton = document.getElementById("logout-button");
const createButton = document.getElementById("create-button");
const categoryFilter = document.getElementById("category-filter");
const itemList = document.getElementById("item-list");
const helpButton = document.getElementById("help-button");
const helpDialog = document.getElementById("help-dialog");
const helpCloseButton = document.getElementById("help-close-button");
const localModeNotice = document.getElementById("local-mode-notice");

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
const TIMELINE_MODE = document.body.dataset.timelineMode || "visible";
const LOCAL_MODE_NOTICE_TEXT =
  "ローカル保存中です。このスマホのブラウザ内に保存されます。機種変更、ブラウザのデータ削除、プライベートブラウズではデータが失われる場合があります。";

const state = {
  uid: null,
  items: [],
  selectedCategories: new Set(CATEGORY_OPTIONS.map((category) => category.value)),
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

function itemUnusedPeriodEndMonth(item) {
  if (!item.endOfUseDate) return itemEndMonth(item);
  return itemPlannedEndMonth(item);
}

function itemTimelineEndMonth(item) {
  if (item.endOfUseDate) {
    return Math.max(itemEndMonth(item), itemUnusedPeriodEndMonth(item));
  }
  return itemEndMonth(item);
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
    maxYear = Math.max(maxYear, Math.ceil(itemTimelineEndMonth(item) / 12));
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

function timelineMonthlyCost(item) {
  return isPcManagementItem(item) ? calculateMonthlyCost(item) : calculateMonthlyCostWithAdditionalCosts(item);
}

function visibleItems() {
  return state.items.filter((item) => state.selectedCategories.has(item.category));
}

function syncSelectedItem(items) {
  if (!items.some((item) => item.id === state.selectedItemId)) {
    state.selectedItemId = items[0]?.id ?? null;
  }
}

function summarizeItems(items) {
  if (!summaryMonthlyCost || !summaryPurchaseTotal || !summaryItemCount) return;

  const activeItems = items.filter((item) => !item.endOfUseDate);
  const monthlyCostTotal = activeItems.reduce(
    (total, item) => total + timelineMonthlyCost(item),
    0
  );
  const purchaseTotal = activeItems.reduce((total, item) => total + Number(item.purchasePrice || 0), 0);

  summaryMonthlyCost.textContent = `${formatCurrency(monthlyCostTotal)} /月`;
  summaryPurchaseTotal.textContent = formatCurrency(purchaseTotal);
  summaryItemCount.textContent = `${items.length} 件`;
}

function renderCategoryFilter() {
  if (!categoryFilter) return;

  categoryFilter.innerHTML = "";
  for (const category of CATEGORY_OPTIONS) {
    const isSelected = state.selectedCategories.has(category.value);
    const button = createElement("button", `category-filter-button category-${category.value}`);
    button.type = "button";
    button.dataset.category = category.value;
    button.setAttribute("aria-label", `${category.label}を${isSelected ? "非表示" : "表示"}`);
    button.setAttribute("aria-pressed", String(isSelected));
    button.title = category.label;
    categoryFilter.appendChild(button);
  }
}

function renderCurrentView() {
  const items = visibleItems();
  syncSelectedItem(items);
  summarizeItems(items);
  renderTimeline(items);
}

function renderLoadingTimeline() {
  itemList.innerHTML = "";
  const loading = createElement("div", "timeline-empty timeline-loading");
  loading.innerHTML = `
    <strong>読込中です</strong>
    <span>データを準備しています。</span>
  `;
  itemList.appendChild(loading);
}

function syncLocalModeUi() {
  const localMode = isLocalMode();
  if (localModeNotice) {
    localModeNotice.hidden = !localMode;
    localModeNotice.textContent = localMode ? LOCAL_MODE_NOTICE_TEXT : "";
  }
  if (logoutButton) {
    logoutButton.textContent = localMode ? "保存終了" : "ログアウト";
    logoutButton.setAttribute("aria-label", localMode ? "ローカル保存を終了" : "ログアウト");
  }
}

function renderEmptyTimeline() {
  itemList.innerHTML = "";
  const empty = createElement("div", "timeline-empty");
  const message =
    TIMELINE_MODE === "hidden"
      ? "帯を表示しない商品はありません。"
      : "家電を登録すると、購入日から耐用年数までのライフサイクル帯を表示します。";
  empty.innerHTML = `
    <strong>登録データがありません</strong>
    <span></span>
  `;
  empty.querySelector("span").textContent = message;
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
    const unusedPeriodEndMonth = itemUnusedPeriodEndMonth(item);
    const plannedEndMonth = itemPlannedEndMonth(item);
    const status = lifecycleStatus(item);
    const left = labelWidth + ((startMonth - minMonth) / 12) * yearWidth;
    const width = Math.max(((endMonth - startMonth) / 12) * yearWidth, timelineLayout().isCompact ? 32 : 84);
    const unusedPeriodLeft = labelWidth + ((endMonth - minMonth) / 12) * yearWidth;
    const unusedPeriodWidth = ((unusedPeriodEndMonth - endMonth) / 12) * yearWidth;
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
    const costText = createElement("span", "band-cost", `${formatCurrency(timelineMonthlyCost(item))} /月`);
    band.append(purchaseText, costText);

    if (item.endOfUseDate && unusedPeriodWidth > 0) {
      const postEndBand = createElement("button", "post-end-band");
      postEndBand.type = "button";
      postEndBand.dataset.id = item.id;
      postEndBand.setAttribute("aria-pressed", String(isSelected));
      postEndBand.setAttribute("aria-label", `${item.name}の使えなかった期間`);
      postEndBand.style.left = `${unusedPeriodLeft}px`;
      postEndBand.style.width = `${Math.max(unusedPeriodWidth, 2)}px`;
      row.appendChild(postEndBand);
    }

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
  return visibleItems().find((item) => item.id === state.selectedItemId) ?? null;
}

function selectItem(itemId) {
  state.selectedItemId = itemId;
  renderTimeline(visibleItems());
  const item = selectedItem();
  openItemNameDialog(item);
}

function openItemNameDialog(item) {
  if (!item || !itemNameDialog) return;
  dialogItemName.textContent = item.name || "商品名未入力";
  dialogItemMeta.textContent = `購入金額${formatCurrency(Number(item.purchasePrice || 0))} / ${formatCurrency(
    timelineMonthlyCost(item)
  )} /月`;
  itemNameDialog.showModal();
}

async function refreshList() {
  const loadedItems = await loadItems(state.uid);
  state.items =
    TIMELINE_MODE === "hidden"
      ? loadedItems.filter((item) => !isPcManagementItem(item) && item.hideFromTimeline)
      : loadedItems.filter((item) => !isPcManagementItem(item) && !item.hideFromTimeline);
  renderCurrentView();
}

summarizeItems([]);
renderLoadingTimeline();
renderCategoryFilter();
syncLocalModeUi();

if (createButton) {
  createButton.addEventListener("click", () => {
    window.location.href = "form.html";
  });
}

if (categoryFilter) {
  categoryFilter.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const button = target.closest(".category-filter-button");
    if (!(button instanceof HTMLButtonElement)) return;

    const category = button.dataset.category;
    if (!category) return;

    if (state.selectedCategories.has(category)) {
      state.selectedCategories.delete(category);
    } else {
      state.selectedCategories.add(category);
    }

    renderCategoryFilter();
    renderCurrentView();
  });
}

if (logoutButton) {
  logoutButton.addEventListener("click", async () => {
    authError.textContent = "";
    try {
      await logout();
      window.location.href = "login.html";
    } catch (error) {
      authError.textContent = firebaseErrorMessage(error, "ログアウトに失敗しました。");
    }
  });
}

itemList.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const band = target.closest(".lifecycle-band, .post-end-band");
  if (!(band instanceof HTMLButtonElement)) return;

  selectItem(band.dataset.id ?? "");
});

dialogEditButton.addEventListener("click", () => {
  const item = selectedItem();
  if (!item) return;
  if (isPcManagementItem(item)) {
    window.location.href = `pc-management/index.html?id=${encodeURIComponent(item.id)}`;
    return;
  }
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

if (helpButton && helpDialog && helpCloseButton) {
  helpButton.addEventListener("click", () => {
    helpDialog.showModal();
  });

  helpCloseButton.addEventListener("click", () => {
    helpDialog.close();
  });

  helpDialog.addEventListener("click", (event) => {
    if (event.target === helpDialog) helpDialog.close();
  });
}

window.addEventListener("resize", () => {
  window.clearTimeout(state.resizeTimer);
  state.resizeTimer = window.setTimeout(() => {
    renderTimeline(visibleItems());
  }, 120);
});

onAuthChanged(async (user) => {
  syncLocalModeUi();
  if (isLocalMode()) {
    state.uid = "local";
    try {
      await refreshList();
    } catch (error) {
      authError.textContent = error?.message || "ローカルデータの取得に失敗しました。";
    }
    return;
  }

  if (!user) {
    window.location.href = "login.html";
    return;
  }
  state.uid = user.uid;
  try {
    await refreshList();
  } catch (error) {
    authError.textContent = firebaseErrorMessage(error, "データ取得に失敗しました。");
  }
});

registerServiceWorker();
