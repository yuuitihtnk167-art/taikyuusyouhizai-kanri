import {
  createLocalBackupData,
  parseLocalBackupText,
  restoreLocalBackupData,
  calculateAdditionalCostTotal,
  calculateMonthlyCost,
  calculateMonthlyCostWithAdditionalCosts,
  formatCurrency,
  CATEGORY_OPTIONS,
  getCategoryLabel,
  isPcManagementItem,
  firebaseErrorMessage,
} from "./common.js";
import { isLocalMode, storageGetItem, storageSetItem } from "./platform/local-db.js";
import { onAuthChanged, logout, registerServiceWorker } from "./services/auth.js";
import { shouldExcludeUnderusedMonthlyCost } from "./services/app-settings.js";
import { loadItems, removeItem, saveItem } from "./storage/durable-items/service.js";
import { calculatePcSummaryAt, loadPcSummaryItems } from "./services/pc-summary.js";

const EDITING_ITEM_ID_KEY = "monthlyApplianceBook.editingItemId";
const CATEGORY_ORDER_STORAGE_KEY = "monthlyApplianceBook.categoryOrder";

const authError = document.getElementById("auth-error");
const logoutButton = document.getElementById("logout-button");
const backupButton = document.getElementById("backup-button");
const restoreButton = document.getElementById("restore-button");
const settingsButton = document.getElementById("settings-button");
const createButton = document.getElementById("create-button");
const categoryFilter = document.getElementById("category-filter");
const itemList = document.getElementById("item-list");
const helpButton = document.getElementById("help-button");
const helpDialog = document.getElementById("help-dialog");
const helpCloseButton = document.getElementById("help-close-button");

const summaryMonthlyCost = document.getElementById("summary-monthly-cost");
const summaryPurchaseTotal = document.getElementById("summary-purchase-total");
const summaryItemCount = document.getElementById("summary-item-count");

const itemNameDialog = document.getElementById("item-name-dialog");
const dialogItemName = document.getElementById("dialog-item-name");
const dialogItemMeta = document.getElementById("dialog-item-meta");
const dialogPcPrompt = document.getElementById("dialog-pc-prompt");
const dialogPcButton = document.getElementById("dialog-pc-button");
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
const SUMMARY_TOGGLE_LONG_PRESS_MS = 600;
const SUMMARY_TOGGLE_MOVE_CANCEL_PX = 10;
const CATEGORY_REORDER_LONG_PRESS_MS = SUMMARY_TOGGLE_LONG_PRESS_MS;
const CATEGORY_REORDER_MOVE_CANCEL_PX = SUMMARY_TOGGLE_MOVE_CANCEL_PX;
const CATEGORY_REORDER_TOUCH_START_PX = CATEGORY_REORDER_MOVE_CANCEL_PX;
const CATEGORY_REORDER_MOUSE_START_PX = 4;
const TIMELINE_MARKER_LONG_PRESS_MS = 500;
const TIMELINE_MARKER_AUTO_SCROLL_EDGE_PX = 48;
const TIMELINE_MARKER_AUTO_SCROLL_MAX_PX = 18;
const TIMELINE_MARKER_VERTICAL_AUTO_SCROLL_EDGE_PX = 72;
const TIMELINE_MARKER_VERTICAL_AUTO_SCROLL_MAX_PX = 16;
const state = {
  uid: null,
  items: [],
  summaryItems: [],
  pcItems: [],
  pcCurrentMonthlyCost: 0,
  pcMonthlyCost: 0,
  pcPurchaseTotal: 0,
  selectedCategories: new Set(CATEGORY_OPTIONS.map((category) => category.value)),
  categoryOrder: loadCategoryOrder(),
  selectedItemId: null,
  resizeTimer: null,
  isBusy: false,
  summaryToggleLongPress: null,
  categoryReorder: null,
  ignoreNextCategoryClick: false,
  timelineMarkerMonth: currentMonthIndex(),
  timelineMarkerDrag: null,
};

function sessionStorageSetItem(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch (_error) {
    // Session storage is best-effort only.
  }
}

function sessionStorageRemoveItem(key) {
  try {
    sessionStorage.removeItem(key);
  } catch (_error) {
    // Session storage is best-effort only.
  }
}

function createElement(tagName, className, textContent = "") {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (textContent) element.textContent = textContent;
  return element;
}

function normalizeCategoryOrder(value) {
  const validCategories = new Set(CATEGORY_OPTIONS.map((category) => category.value));
  const normalizedOrder = [];

  for (const category of Array.isArray(value) ? value : []) {
    if (!validCategories.has(category) || normalizedOrder.includes(category)) continue;
    normalizedOrder.push(category);
  }
  for (const category of CATEGORY_OPTIONS) {
    if (!normalizedOrder.includes(category.value)) normalizedOrder.push(category.value);
  }
  return normalizedOrder;
}

function loadCategoryOrder() {
  try {
    return normalizeCategoryOrder(JSON.parse(storageGetItem(CATEGORY_ORDER_STORAGE_KEY) ?? "null"));
  } catch (_error) {
    return normalizeCategoryOrder([]);
  }
}

function saveCategoryOrder() {
  try {
    storageSetItem(CATEGORY_ORDER_STORAGE_KEY, JSON.stringify(state.categoryOrder));
  } catch (_error) {
    // Category order is best-effort when browser storage is unavailable.
  }
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

function isPcManagementLinkedItem(item) {
  return Boolean(item?.pcManagementLinked);
}

function itemStartMonth(item) {
  if (isPcManagementLinkedItem(item)) return TIMELINE_MIN_YEAR * 12;
  const purchaseDate = parseDate(item.purchaseDate);
  return purchaseDate ? toMonthPosition(purchaseDate) : TIMELINE_MIN_YEAR * 12;
}

function currentMonthIndex() {
  return toMonthPosition(new Date());
}

function itemPlannedEndMonth(item) {
  if (isPcManagementLinkedItem(item)) return TIMELINE_MAX_YEAR * 12;
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
  if (isPcManagementLinkedItem(item)) return "";
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
  const index = state.categoryOrder.indexOf(categoryValue);
  return index === -1 ? state.categoryOrder.length : index;
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

function updatePcSummaryForMonth(monthPosition = timelineMarkerMonth()) {
  const summary = calculatePcSummaryAt(state.pcItems, monthPosition);
  state.pcMonthlyCost = summary.monthlyCost;
  state.pcPurchaseTotal = summary.purchaseTotal;
}

function isTimelineMarkerAtCurrentMonth() {
  return Math.floor(timelineMarkerMonth()) === currentMonthIndex();
}

function updatePcLinkedCostDisplays() {
  itemList.querySelectorAll(".pc-linked-current-cost").forEach((element) => {
    element.textContent = `${formatCurrency(state.pcCurrentMonthlyCost)} /\u6708`;
  });
  itemList.querySelectorAll(".pc-linked-selected-cost").forEach((element) => {
    element.textContent = `\u9078\u629e\u6708 ${formatCurrency(state.pcMonthlyCost)} /\u6708`;
    element.hidden = isTimelineMarkerAtCurrentMonth();
  });
}

function timelineMonthlyCost(item) {
  if (isPcManagementLinkedItem(item)) return state.pcMonthlyCost;
  return isPcManagementItem(item) ? calculateMonthlyCost(item) : calculateMonthlyCostWithAdditionalCosts(item);
}

function itemSummaryMonthlyCost(item, monthPosition = timelineMarkerMonth()) {
  if (isPcManagementLinkedItem(item)) return state.pcMonthlyCost;
  return itemPlannedEndMonth(item) < monthPosition ? 0 : timelineMonthlyCost(item);
}

function displayedMonthlyCost(item) {
  return Math.round(itemSummaryMonthlyCost(item));
}

function totalPurchaseCost(item) {
  if (isPcManagementLinkedItem(item)) return state.pcPurchaseTotal;
  return Number(item.purchasePrice || 0) + calculateAdditionalCostTotal(item);
}

function timelineMarkerMonth() {
  return Number.isFinite(state.timelineMarkerMonth) ? state.timelineMarkerMonth : currentMonthIndex();
}

function activeEndMonth(item) {
  if (isUnderusedEndedItem(item) && !shouldExcludeUnderusedMonthlyCost()) {
    return itemPlannedEndMonth(item);
  }
  if (item.endOfUseDate) return itemActualEndMonth(item);
  return Math.max(itemPlannedEndMonth(item), currentMonthIndex());
}

function isActiveAtTimelineMarker(item, monthPosition = timelineMarkerMonth()) {
  return itemStartMonth(item) <= monthPosition && monthPosition <= activeEndMonth(item);
}

function summaryActiveEndMonth(item) {
  if (isUnderusedEndedItem(item) && !shouldExcludeUnderusedMonthlyCost()) {
    return itemPlannedEndMonth(item);
  }
  if (item.endOfUseDate) {
    return Math.min(itemActualEndMonth(item), itemPlannedEndMonth(item));
  }
  return itemPlannedEndMonth(item);
}

function isActiveInSummaryAtTimelineMarker(item, monthPosition = timelineMarkerMonth()) {
  return itemStartMonth(item) <= monthPosition && monthPosition <= summaryActiveEndMonth(item);
}

function isMonthlyCostExcluded(item) {
  return isActualUseEnded(item) && itemPlannedEndMonth(item) <= currentMonthIndex();
}

function isActualUseEnded(item) {
  return Boolean(item.endOfUseDate) && itemActualEndMonth(item) <= currentMonthIndex();
}

function isUnderusedEndedItem(item) {
  return (
    isActualUseEnded(item) &&
    itemActualEndMonth(item) < itemPlannedEndMonth(item) &&
    currentMonthIndex() < itemPlannedEndMonth(item)
  );
}

function isMonthlyCostSummaryExcluded(item) {
  if (isMonthlyCostExcluded(item)) {
    return true;
  }
  if (isUnderusedEndedItem(item)) {
    return shouldExcludeUnderusedMonthlyCost();
  }
  return false;
}

function isSummaryExcluded(item) {
  return Boolean(item.excludeFromSummary);
}

function timelineLabelClass(item) {
  const classes = ["timeline-row-label"];
  if (isMonthlyCostSummaryExcluded(item)) classes.push("monthly-cost-excluded");
  if (isSummaryExcluded(item)) classes.push("summary-excluded");
  return classes.join(" ");
}

function visibleItems() {
  return state.items.filter((item) => state.selectedCategories.has(item.category));
}

function summaryItems() {
  return state.summaryItems.filter((item) => state.selectedCategories.has(item.category));
}

function syncSelectedItem(items) {
  if (!items.some((item) => item.id === state.selectedItemId)) {
    state.selectedItemId = items[0]?.id ?? null;
  }
}

function summarizeItems(items) {
  if (!summaryMonthlyCost || !summaryPurchaseTotal || !summaryItemCount) return;

  const monthPosition = timelineMarkerMonth();
  const activeItems = items.filter(
    (item) => !isSummaryExcluded(item) && isActiveInSummaryAtTimelineMarker(item, monthPosition)
  );
  const monthlyCostTotal = activeItems.reduce(
    (total, item) => total + Math.round(itemSummaryMonthlyCost(item, monthPosition)),
    0
  );
  const purchaseTotal = activeItems.reduce((total, item) => total + totalPurchaseCost(item), 0);

  summaryMonthlyCost.textContent = `${formatCurrency(monthlyCostTotal)} /月`;
  summaryPurchaseTotal.textContent = formatCurrency(purchaseTotal);
  summaryItemCount.textContent = `${activeItems.length} 件`;
}

function renderCategoryFilter() {
  if (!categoryFilter) return;

  categoryFilter.innerHTML = "";
  for (const categoryValue of state.categoryOrder) {
    const category = CATEGORY_OPTIONS.find((option) => option.value === categoryValue);
    if (!category) continue;

    const isSelected = state.selectedCategories.has(category.value);
    const button = createElement("button", `category-filter-button category-${category.value}`);
    button.type = "button";
    button.dataset.category = category.value;
    button.setAttribute("aria-label", `${category.label}を${isSelected ? "非表示" : "表示"}`);
    button.setAttribute("aria-pressed", String(isSelected));
    button.setAttribute("aria-grabbed", "false");
    button.title = category.label;
    categoryFilter.appendChild(button);
  }
}

function categoryFilterButton(target) {
  if (!(target instanceof HTMLElement)) return null;
  const button = target.closest(".category-filter-button");
  return button instanceof HTMLButtonElement ? button : null;
}

function clearCategoryReorder() {
  const reorder = state.categoryReorder;
  if (!reorder) return null;

  window.clearTimeout(reorder.timer);
  state.categoryReorder = null;
  reorder.button.classList.remove("dragging");
  reorder.button.setAttribute("aria-grabbed", "false");
  categoryFilter?.classList.remove("reordering");
  if (reorder.button.hasPointerCapture?.(reorder.pointerId)) {
    reorder.button.releasePointerCapture(reorder.pointerId);
  }
  return reorder;
}

function beginCategoryReorder() {
  const reorder = state.categoryReorder;
  if (!reorder || reorder.isDragging) return;
  reorder.isDragging = true;
  reorder.dragStartX = reorder.currentX;
  reorder.dragStartY = reorder.currentY;
  reorder.isMovementReady = reorder.pointerType === "mouse";
  reorder.button.classList.add("dragging");
  reorder.button.setAttribute("aria-grabbed", "true");
  categoryFilter?.classList.add("reordering");
}

function startCategoryReorder(event) {
  if (event.pointerType === "mouse" && event.button !== 0) return;
  if (state.categoryReorder) return;

  const button = categoryFilterButton(event.target);
  if (!button) return;

  const reorder = {
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    button,
    startX: event.clientX,
    startY: event.clientY,
    currentX: event.clientX,
    currentY: event.clientY,
    isDragging: false,
    timer: null,
  };
  state.categoryReorder = reorder;
  button.setPointerCapture?.(event.pointerId);

  if (event.pointerType !== "mouse") {
    reorder.timer = window.setTimeout(beginCategoryReorder, CATEGORY_REORDER_LONG_PRESS_MS);
  }
}

function moveCategoryButton(event) {
  const reorder = state.categoryReorder;
  if (!reorder || reorder.pointerId !== event.pointerId) return;

  reorder.currentX = event.clientX;
  reorder.currentY = event.clientY;
  const movedX = Math.abs(event.clientX - reorder.startX);
  const movedY = Math.abs(event.clientY - reorder.startY);
  if (!reorder.isDragging) {
    if (reorder.pointerType === "mouse") {
      if (Math.max(movedX, movedY) < CATEGORY_REORDER_MOUSE_START_PX) return;
      beginCategoryReorder();
    } else {
      if (movedX > CATEGORY_REORDER_MOVE_CANCEL_PX || movedY > CATEGORY_REORDER_MOVE_CANCEL_PX) {
        clearCategoryReorder();
      }
      return;
    }
  }

  event.preventDefault();
  if (!reorder.isMovementReady) {
    const dragMovedX = Math.abs(event.clientX - reorder.dragStartX);
    const dragMovedY = Math.abs(event.clientY - reorder.dragStartY);
    if (Math.max(dragMovedX, dragMovedY) < CATEGORY_REORDER_TOUCH_START_PX) return;
    reorder.isMovementReady = true;
  }

  const targetButton = categoryFilterButton(document.elementFromPoint(event.clientX, event.clientY));
  if (!targetButton || targetButton === reorder.button || targetButton.parentElement !== categoryFilter) return;

  const targetRect = targetButton.getBoundingClientRect();
  const insertBeforeTarget = event.clientX < targetRect.left + targetRect.width / 2;
  categoryFilter.insertBefore(reorder.button, insertBeforeTarget ? targetButton : targetButton.nextSibling);
}

function finishCategoryReorder(event) {
  const reorder = state.categoryReorder;
  if (!reorder || reorder.pointerId !== event.pointerId) return;
  const wasDragging = reorder.isDragging;
  clearCategoryReorder();
  if (!wasDragging) return;

  state.categoryOrder = normalizeCategoryOrder(
    [...categoryFilter.querySelectorAll(".category-filter-button")]
      .map((button) => button.dataset.category)
  );
  saveCategoryOrder();
  state.ignoreNextCategoryClick = true;
  window.setTimeout(() => {
    state.ignoreNextCategoryClick = false;
  }, 0);
  renderCategoryFilter();
  renderCurrentView();
}

function cancelCategoryReorder(event) {
  const reorder = state.categoryReorder;
  if (!reorder || reorder.pointerId !== event.pointerId) return;
  const wasDragging = reorder.isDragging;
  clearCategoryReorder();
  if (wasDragging) renderCategoryFilter();
}

function renderCurrentView() {
  const items = visibleItems();
  syncSelectedItem(items);
  summarizeItems(summaryItems());
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

function renderTimelineError(message) {
  itemList.innerHTML = "";
  const error = createElement("div", "timeline-empty");
  error.textContent = message;
  itemList.appendChild(error);
}

function syncLocalModeUi() {
  const localMode = isLocalMode();
  if (logoutButton) {
    logoutButton.textContent = "ログアウト";
    logoutButton.setAttribute("aria-label", localMode ? "ローカル保存を終了" : "ログアウト");
  }
  if (backupButton) backupButton.hidden = !localMode;
  if (restoreButton) restoreButton.hidden = !localMode;
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
  const currentLabelPosition = actualCurrentLinePosition(minYear, maxYear);

  if (currentPosition !== null) {
    const currentLine = createElement("div", "timeline-current-line");
    currentLine.style.left = `${currentPosition}px`;
    grid.appendChild(currentLine);

    const currentHandle = createElement("button", "timeline-current-handle", "✋");
    currentHandle.type = "button";
    currentHandle.dataset.action = "drag-current-line";
    currentHandle.setAttribute("aria-label", "現在ラインを動かす");
    currentHandle.style.left = `${currentPosition}px`;
    grid.appendChild(currentHandle);

    const bottomHandle = currentHandle.cloneNode(true);
    bottomHandle.classList.add("bottom");
    grid.appendChild(bottomHandle);
  }

  if (currentLabelPosition !== null) {
    const currentLabel = createElement("div", "timeline-current-label", "現在");
    currentLabel.style.left = `${currentLabelPosition}px`;
    grid.appendChild(currentLabel);
  }
}

function actualCurrentLinePosition(minYear, maxYear) {
  const { labelWidth, yearWidth } = timelineLayout();
  const minMonth = minYear * 12;
  const maxMonth = maxYear * 12;
  const nowPosition = currentMonthIndex();

  if (nowPosition < minMonth || nowPosition > maxMonth) return null;
  return labelWidth + ((nowPosition - minMonth) / 12) * yearWidth;
}

function currentLinePosition(minYear, maxYear) {
  const { labelWidth, yearWidth } = timelineLayout();
  const minMonth = minYear * 12;
  const maxMonth = maxYear * 12;
  const markerMonth = timelineMarkerMonth();

  if (markerMonth < minMonth || markerMonth > maxMonth) return null;
  return labelWidth + ((markerMonth - minMonth) / 12) * yearWidth;
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
  grid.dataset.minYear = String(minYear);
  grid.dataset.maxYear = String(maxYear);
  grid.style.width = `${timelineWidth}px`;
  grid.style.setProperty("--label-width", `${labelWidth}px`);
  grid.style.setProperty("--year-width", `${yearWidth}px`);

  renderAxis(grid, minYear, maxYear, "timeline-axis-top");
  renderCurrentLine(grid, minYear, maxYear);

  const rows = createElement("div", "timeline-rows");
  for (const item of sortedItems) {
    const isLinkedToPcManagement = isPcManagementLinkedItem(item);
    const startMonth = isLinkedToPcManagement ? minMonth : itemStartMonth(item);
    const endMonth = isLinkedToPcManagement ? maxYear * 12 : itemEndMonth(item);
    const unusedPeriodEndMonth = itemUnusedPeriodEndMonth(item);
    const plannedEndMonth = isLinkedToPcManagement ? maxYear * 12 : itemPlannedEndMonth(item);
    const status = lifecycleStatus(item);
    const left = labelWidth + ((startMonth - minMonth) / 12) * yearWidth;
    const width = Math.max(((endMonth - startMonth) / 12) * yearWidth, timelineLayout().isCompact ? 32 : 84);
    const unusedPeriodLeft = labelWidth + ((endMonth - minMonth) / 12) * yearWidth;
    const unusedPeriodWidth = ((unusedPeriodEndMonth - endMonth) / 12) * yearWidth;
    const overuseStartPercent = ((plannedEndMonth - startMonth) / Math.max(endMonth - startMonth, 1)) * 100;
    const isOverused = !isLinkedToPcManagement && itemActualEndMonth(item) > plannedEndMonth;
    const isSelected = item.id === state.selectedItemId;

    const row = createElement("div", "timeline-row");
    const label = createElement(
      "div",
      timelineLabelClass(item)
    );
    label.dataset.action = "toggle-summary";
    label.dataset.id = item.id;
    label.innerHTML = `<span class="category-swatch category-${item.category}"></span><strong></strong>`;
    label.querySelector("strong").textContent = displayApplianceType(item);

    const band = createElement("button", `lifecycle-band category-${item.category}${isOverused ? " overused" : ""}`);
    band.type = "button";
    band.dataset.id = item.id;
    band.setAttribute("aria-pressed", String(isSelected));
    band.setAttribute("aria-label", `${item.name}の詳細を表示`);
    band.style.left = `${left}px`;
    band.style.width = `${width}px`;
    if (isLinkedToPcManagement) {
      band.classList.add("pc-management-linked");
    }
    if (isOverused) {
      band.style.setProperty("--overuse-start", `${Math.min(Math.max(overuseStartPercent, 0), 100)}%`);
      band.classList.add("is-overused");
    }

    const purchaseText = createElement("span", "band-name", item.name || "商品名未入力");
    const costText = createElement("span", "band-cost", `${formatCurrency(timelineMonthlyCost(item))} /月`);
    band.append(purchaseText, costText);

    if (isLinkedToPcManagement) {
      const linkedLabel = createElement("span", "pc-linked-cost-label");
      const selectedCost = createElement(
        "span",
        "pc-linked-selected-cost",
        `\u9078\u629e\u6708 ${formatCurrency(state.pcMonthlyCost)} /\u6708`
      );
      selectedCost.hidden = isTimelineMarkerAtCurrentMonth();
      linkedLabel.append(
        createElement("span", "pc-linked-reflection", "PC\u7ba1\u7406\u3092\u53cd\u6620"),
        createElement("span", "pc-linked-current-cost", `${formatCurrency(state.pcCurrentMonthlyCost)} /\u6708`),
        selectedCost
      );
      row.appendChild(linkedLabel);
    }

    if (isOverused) {
      const plannedCostLabel = costText.cloneNode(true);
      plannedCostLabel.className = "timeline-planned-cost-label";
      plannedCostLabel.style.left = `${labelWidth + ((plannedEndMonth - minMonth) / 12) * yearWidth}px`;
      row.appendChild(plannedCostLabel);
    }

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

    if (isOverused) {
      const zeroCostLabel = costText.cloneNode(true);
      zeroCostLabel.className = "timeline-zero-cost-label";
      zeroCostLabel.textContent = `${formatCurrency(0)} /${String.fromCharCode(26376)}`;
      endLabel.append(" ", zeroCostLabel);
    }

    row.append(label, band, endLabel);
    rows.appendChild(row);
  }

  grid.appendChild(rows);
  renderAxis(grid, minYear, maxYear, "timeline-axis-bottom");
  scroll.appendChild(grid);
  itemList.appendChild(scroll);

  const updateLinkedLabelPosition = () => {
    const visibleLeft = scroll.scrollLeft + labelWidth;
    const visibleRight = scroll.scrollLeft + scroll.clientWidth;
    const visibleCenter = (visibleLeft + visibleRight) / 2;
    grid.querySelectorAll(".pc-linked-cost-label").forEach((label) => {
      label.style.left = `${visibleCenter}px`;
    });
  };
  scroll.addEventListener("scroll", updateLinkedLabelPosition, { passive: true });
  requestAnimationFrame(updateLinkedLabelPosition);
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
  const isLinked = isPcManagementLinkedItem(item);
  dialogItemMeta.textContent = isLinked
    ? `PC\u7ba1\u7406\u3092\u53cd\u6620 ${formatCurrency(state.pcCurrentMonthlyCost)} /\u6708`
    : `\u8cfc\u5165\u91d1\u984d${formatCurrency(Number(item.purchasePrice || 0))} / ${formatCurrency(
      timelineMonthlyCost(item)
    )} /\u6708`;
  if (dialogPcPrompt && dialogPcButton) {
    dialogPcPrompt.hidden = !isLinked;
    dialogPcButton.hidden = !isLinked;
    dialogPcPrompt.textContent = "PC\u7ba1\u7406\u3092\u8868\u793a\u3057\u307e\u3059\u304b\uff1f";
    dialogPcButton.textContent = "PC\u7ba1\u7406\u3092\u8868\u793a";
  }
  itemNameDialog.showModal();
}

async function refreshList() {
  const [loadedItems, pcItems] = await Promise.all([
    loadItems(state.uid),
    loadPcSummaryItems(state.uid),
  ]);
  state.pcItems = pcItems;
  state.pcCurrentMonthlyCost = calculatePcSummaryAt(pcItems, currentMonthIndex()).monthlyCost;
  updatePcSummaryForMonth();
  state.summaryItems = loadedItems.filter((item) => !isPcManagementItem(item));
  state.items =
    TIMELINE_MODE === "hidden"
      ? loadedItems.filter((item) => !isPcManagementItem(item) && item.hideFromTimeline)
      : loadedItems.filter((item) => !isPcManagementItem(item) && !item.hideFromTimeline);
  renderCurrentView();
}

async function toggleSummaryExclusion(itemId) {
  const item = state.summaryItems.find((currentItem) => currentItem.id === itemId);
  if (!item || !state.uid) return;
  const shouldExclude = !isSummaryExcluded(item);

  authError.textContent = "";
  try {
    await saveItem(state.uid, {
      ...item,
      isUpdate: true,
      excludeFromSummary: shouldExclude,
    });
    await refreshList();
    showSummaryToggleMessage(shouldExclude ? "月額合計から除外しました" : "月額合計に含めました");
  } catch (error) {
    authError.textContent = firebaseErrorMessage(error, "集計対象の切り替えに失敗しました。");
  }
}

function showSummaryToggleMessage(message) {
  const dialog = document.createElement("dialog");
  dialog.className = "item-name-dialog";

  const card = document.createElement("article");
  card.className = "item-name-dialog-card";

  const text = document.createElement("p");
  text.className = "dialog-item-meta";
  text.textContent = message;

  card.append(text);
  dialog.append(card);
  document.body.append(dialog);

  const closeDialog = () => {
    if (dialog.open) dialog.close();
  };

  dialog.addEventListener("click", closeDialog);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  dialog.showModal();
  window.setTimeout(closeDialog, 1400);
}

function summaryToggleTarget(target) {
  if (!(target instanceof HTMLElement)) return null;
  const summaryToggle = target.closest("[data-action='toggle-summary']");
  return summaryToggle instanceof HTMLElement ? summaryToggle : null;
}

function timelineMarkerDragTarget(target) {
  if (!(target instanceof HTMLElement)) return null;
  const handle = target.closest("[data-action='drag-current-line']");
  return handle instanceof HTMLElement ? handle : null;
}

function timelineMonthFromClientX(clientX, scroll, minYear, maxYear) {
  const { labelWidth, yearWidth } = timelineLayout();
  const rect = scroll.getBoundingClientRect();
  const minMonth = minYear * 12;
  const maxMonth = maxYear * 12;
  const x = scroll.scrollLeft + clientX - rect.left;
  const monthPosition = minMonth + ((x - labelWidth) / yearWidth) * 12;
  return Math.min(Math.max(monthPosition, minMonth), maxMonth);
}

function applyTimelineMarkerDragPosition(drag) {
  state.timelineMarkerMonth = timelineMonthFromClientX(drag.clientX, drag.scroll, drag.minYear, drag.maxYear);
  updatePcSummaryForMonth();
  const position = currentLinePosition(drag.minYear, drag.maxYear);
  if (position !== null) {
    drag.line.style.left = `${position}px`;
    drag.handles.forEach((handle) => {
      handle.style.left = `${position}px`;
    });
  }
  summarizeItems(summaryItems());
  updatePcLinkedCostDisplays();
}

function timelineMarkerAutoScrollSpeed(drag) {
  const rect = drag.scroll.getBoundingClientRect();
  const leftDistance = drag.clientX - rect.left;
  const rightDistance = rect.right - drag.clientX;
  const edge = TIMELINE_MARKER_AUTO_SCROLL_EDGE_PX;
  const maxSpeed = TIMELINE_MARKER_AUTO_SCROLL_MAX_PX;

  if (leftDistance < edge) {
    return -Math.ceil(((edge - Math.max(leftDistance, 0)) / edge) * maxSpeed);
  }
  if (rightDistance < edge) {
    return Math.ceil(((edge - Math.max(rightDistance, 0)) / edge) * maxSpeed);
  }
  return 0;
}

function timelineMarkerVerticalAutoScrollSpeed(drag) {
  const edge = TIMELINE_MARKER_VERTICAL_AUTO_SCROLL_EDGE_PX;
  const maxSpeed = TIMELINE_MARKER_VERTICAL_AUTO_SCROLL_MAX_PX;
  const topDistance = drag.clientY;
  const bottomDistance = window.innerHeight - drag.clientY;

  if (topDistance < edge) {
    return -Math.ceil(((edge - Math.max(topDistance, 0)) / edge) * maxSpeed);
  }
  if (bottomDistance < edge) {
    return Math.ceil(((edge - Math.max(bottomDistance, 0)) / edge) * maxSpeed);
  }
  return 0;
}

function stopTimelineMarkerAutoScroll(drag) {
  if (!drag?.autoScrollFrame) return;
  cancelAnimationFrame(drag.autoScrollFrame);
  drag.autoScrollFrame = null;
}

function startTimelineMarkerAutoScroll(drag) {
  if (drag.autoScrollFrame) return;

  const scroll = () => {
    if (state.timelineMarkerDrag !== drag || !drag.isDragging) {
      stopTimelineMarkerAutoScroll(drag);
      return;
    }

    const horizontalSpeed = timelineMarkerAutoScrollSpeed(drag);
    const verticalSpeed = timelineMarkerVerticalAutoScrollSpeed(drag);
    if (horizontalSpeed === 0 && verticalSpeed === 0) {
      stopTimelineMarkerAutoScroll(drag);
      return;
    }

    const beforeScrollLeft = drag.scroll.scrollLeft;
    const beforeScrollY = window.scrollY;
    const maxScrollLeft = Math.max(drag.scroll.scrollWidth - drag.scroll.clientWidth, 0);
    drag.scroll.scrollLeft = Math.min(Math.max(beforeScrollLeft + horizontalSpeed, 0), maxScrollLeft);
    if (verticalSpeed !== 0) {
      window.scrollBy(0, verticalSpeed);
    }

    if (drag.scroll.scrollLeft === beforeScrollLeft && window.scrollY === beforeScrollY) {
      stopTimelineMarkerAutoScroll(drag);
      return;
    }

    applyTimelineMarkerDragPosition(drag);
    drag.autoScrollFrame = requestAnimationFrame(scroll);
  };

  drag.autoScrollFrame = requestAnimationFrame(scroll);
}

function updateTimelineMarkerDrag(event) {
  const drag = state.timelineMarkerDrag;
  if (!drag?.isDragging) return;

  drag.clientX = event.clientX;
  drag.clientY = event.clientY;
  applyTimelineMarkerDragPosition(drag);

  if (timelineMarkerAutoScrollSpeed(drag) === 0 && timelineMarkerVerticalAutoScrollSpeed(drag) === 0) {
    stopTimelineMarkerAutoScroll(drag);
  } else {
    startTimelineMarkerAutoScroll(drag);
  }
}

function clearTimelineMarkerDrag() {
  const drag = state.timelineMarkerDrag;
  if (!drag) return;

  window.clearTimeout(drag.timer);
  stopTimelineMarkerAutoScroll(drag);
  if (drag.isDragging) {
    drag.line.classList.remove("dragging");
    drag.handles.forEach((handle) => handle.classList.remove("dragging"));
    try {
      drag.handle.releasePointerCapture(drag.pointerId);
    } catch (_error) {
      // Pointer capture may already be released by the browser.
    }
  }
  state.timelineMarkerDrag = null;
}

function beginTimelineMarkerDrag(event, drag) {
  drag.isDragging = true;
  drag.line.classList.add("dragging");
  drag.handles.forEach((handle) => handle.classList.add("dragging"));
  drag.handle.setPointerCapture?.(event.pointerId);
  updateTimelineMarkerDrag(event);
}

function startTimelineMarkerDrag(event) {
  if (event.pointerType === "mouse" && event.button !== 0) return;

  const handle = timelineMarkerDragTarget(event.target);
  if (!handle) return;

  const grid = handle.closest(".timeline-grid");
  const scroll = handle.closest(".timeline-scroll");
  if (!(grid instanceof HTMLElement) || !(scroll instanceof HTMLElement)) return;

  const line = grid.querySelector(".timeline-current-line");
  if (!(line instanceof HTMLElement)) return;

  const drag = {
    handle,
    handles: [...grid.querySelectorAll(".timeline-current-handle")],
    line,
    scroll,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    clientX: event.clientX,
    clientY: event.clientY,
    minYear: Number(grid.dataset.minYear),
    maxYear: Number(grid.dataset.maxYear),
    isDragging: false,
    timer: 0,
    autoScrollFrame: null,
  };
  if (!Number.isFinite(drag.minYear) || !Number.isFinite(drag.maxYear)) return;

  clearTimelineMarkerDrag();
  state.timelineMarkerDrag = drag;

  if (event.pointerType === "mouse") {
    event.preventDefault();
    beginTimelineMarkerDrag(event, drag);
    return;
  }

  drag.timer = window.setTimeout(() => {
    beginTimelineMarkerDrag(event, drag);
  }, TIMELINE_MARKER_LONG_PRESS_MS);
}

function moveTimelineMarkerDrag(event) {
  const drag = state.timelineMarkerDrag;
  if (!drag || drag.pointerId !== event.pointerId) return;

  if (!drag.isDragging) {
    const movedX = Math.abs(event.clientX - drag.startX);
    const movedY = Math.abs(event.clientY - drag.startY);
    if (movedX > SUMMARY_TOGGLE_MOVE_CANCEL_PX || movedY > SUMMARY_TOGGLE_MOVE_CANCEL_PX) {
      clearTimelineMarkerDrag();
    }
    return;
  }

  event.preventDefault();
  updateTimelineMarkerDrag(event);
}

function endTimelineMarkerDrag(event) {
  if (!state.timelineMarkerDrag || state.timelineMarkerDrag.pointerId !== event.pointerId) return;
  clearTimelineMarkerDrag();
}

function clearSummaryToggleLongPress() {
  if (!state.summaryToggleLongPress) return;
  window.clearTimeout(state.summaryToggleLongPress.timer);
  state.summaryToggleLongPress = null;
}

function startSummaryToggleLongPress(event) {
  if (event.pointerType === "mouse" && event.button !== 0) return;

  const summaryToggle = summaryToggleTarget(event.target);
  const itemId = summaryToggle?.dataset.id;
  if (!summaryToggle || !itemId) return;

  clearSummaryToggleLongPress();
  state.summaryToggleLongPress = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    timer: window.setTimeout(() => {
      state.summaryToggleLongPress = null;
      toggleSummaryExclusion(itemId);
    }, SUMMARY_TOGGLE_LONG_PRESS_MS),
  };
}

function cancelSummaryToggleLongPress(event) {
  if (!state.summaryToggleLongPress || state.summaryToggleLongPress.pointerId !== event.pointerId) return;
  clearSummaryToggleLongPress();
}

function cancelMovedSummaryToggleLongPress(event) {
  const longPress = state.summaryToggleLongPress;
  if (!longPress || longPress.pointerId !== event.pointerId) return;

  const movedX = Math.abs(event.clientX - longPress.startX);
  const movedY = Math.abs(event.clientY - longPress.startY);
  if (movedX > SUMMARY_TOGGLE_MOVE_CANCEL_PX || movedY > SUMMARY_TOGGLE_MOVE_CANCEL_PX) {
    clearSummaryToggleLongPress();
  }
}

summarizeItems([]);
renderLoadingTimeline();
renderCategoryFilter();
syncLocalModeUi();

if (createButton) {
  createButton.addEventListener("click", () => {
    sessionStorageRemoveItem(EDITING_ITEM_ID_KEY);
    window.location.href = "form.html";
  });
}

settingsButton?.addEventListener("click", () => {
  window.location.href = "settings.html";
});

if (categoryFilter) {
  categoryFilter.addEventListener("click", (event) => {
    if (state.ignoreNextCategoryClick) {
      state.ignoreNextCategoryClick = false;
      event.preventDefault();
      return;
    }

    const button = categoryFilterButton(event.target);
    if (!button) return;

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
  categoryFilter.addEventListener("pointerdown", startCategoryReorder);
  categoryFilter.addEventListener("pointermove", moveCategoryButton);
  categoryFilter.addEventListener("pointerup", finishCategoryReorder);
  categoryFilter.addEventListener("pointercancel", cancelCategoryReorder);
  categoryFilter.addEventListener("contextmenu", (event) => {
    if (categoryFilterButton(event.target)) event.preventDefault();
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

function fileTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function backupFileName() {
  return `月額家電簿-backup-${fileTimestamp()}.json`;
}

function downloadBackupFile(backup, fileName = backupFileName()) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

if (backupButton) {
  backupButton.addEventListener("click", async () => {
    authError.textContent = "";
    if (!isLocalMode()) {
      authError.textContent = "保存はローカル保存モードでのみ使用できます。";
      return;
    }
    try {
      state.isBusy = true;
      backupButton.disabled = true;
      downloadBackupFile(await createLocalBackupData());
    } catch (error) {
      authError.textContent = error?.message || "バックアップの保存に失敗しました。";
    } finally {
      state.isBusy = false;
      backupButton.disabled = false;
    }
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("ファイルを読み込めません。")));
    reader.readAsText(file);
  });
}

function selectBackupFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.click();
  });
}

if (restoreButton) {
  restoreButton.addEventListener("click", async () => {
    authError.textContent = "";
    if (!isLocalMode()) {
      authError.textContent = "復元はローカル保存モードでのみ使用できます。";
      return;
    }
    try {
      state.isBusy = true;
      const file = await selectBackupFile();
      if (!file) return;
      const backup = parseLocalBackupText(await readFileAsText(file));
      const shouldRestore = confirm("現在のローカル保存データをバックアップ内容で上書きします。よろしいですか？");
      if (!shouldRestore) return;

      restoreButton.disabled = true;
      await restoreLocalBackupData(backup);
      state.selectedItemId = null;
      await refreshList();
    } catch (error) {
      authError.textContent = error?.message || "バックアップの復元に失敗しました。";
    } finally {
      state.isBusy = false;
      restoreButton.disabled = false;
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

itemList.addEventListener("pointerdown", startTimelineMarkerDrag);
itemList.addEventListener("pointermove", moveTimelineMarkerDrag);
itemList.addEventListener("pointerup", endTimelineMarkerDrag);
itemList.addEventListener("pointercancel", endTimelineMarkerDrag);
itemList.addEventListener("pointerleave", endTimelineMarkerDrag);
itemList.addEventListener("pointerdown", startSummaryToggleLongPress);
itemList.addEventListener("pointerup", cancelSummaryToggleLongPress);
itemList.addEventListener("pointercancel", cancelSummaryToggleLongPress);
itemList.addEventListener("pointerleave", cancelSummaryToggleLongPress);
itemList.addEventListener("pointermove", cancelMovedSummaryToggleLongPress);

dialogPcButton?.addEventListener("click", () => {
  const item = selectedItem();
  if (!isPcManagementLinkedItem(item)) return;
  window.location.href = "pc-management/index.html";
});

dialogEditButton.addEventListener("click", () => {
  const item = selectedItem();
  if (!item) return;
  if (isPcManagementItem(item)) {
    window.location.href = `pc-management/index.html?id=${encodeURIComponent(item.id)}`;
    return;
  }
  sessionStorageSetItem(EDITING_ITEM_ID_KEY, item.id);
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

async function initializeLocalList() {
  syncLocalModeUi();
  state.uid = "local";
  try {
    await refreshList();
  } catch (error) {
    authError.textContent = error?.message || "ローカルデータの取得に失敗しました。";
    renderTimelineError("データの取得に失敗しました。");
  }
}

if (isLocalMode()) {
  initializeLocalList();
} else {
  onAuthChanged(async (user) => {
    syncLocalModeUi();

    if (!user) {
      window.location.href = "login.html";
      return;
    }
    state.uid = user.uid;
    try {
      await refreshList();
    } catch (error) {
      authError.textContent = firebaseErrorMessage(error, "データ取得に失敗しました。");
      renderTimelineError("データの取得に失敗しました。");
    }
  });
}

registerServiceWorker();
