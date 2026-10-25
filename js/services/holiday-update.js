import { JAPANESE_HOLIDAYS } from "./japanese-holidays.js?v=156";

export const HOLIDAY_UPDATE_URL = "https://holidays-jp.github.io/api/v1/date.json";
export const HOLIDAY_UPDATE_KEY = "monthlyApplianceBook.holidayCalendar";
let hash = 2166136261;
for (const char of [...JAPANESE_HOLIDAYS].sort().join(",")) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
export const BUNDLED_HOLIDAY_REVISION = (hash >>> 0).toString(16);
let cachedRaw;
let cachedValue = null;

function storageOrDefault(storage) {
  return storage ?? globalThis.localStorage;
}

export function validateHolidayDates(dates) {
  if (!Array.isArray(dates) || dates.length === 0 || dates.length > 10000) throw new Error("祝日データの形式が正しくありません。");
  const byYear = new Map();
  const unique = new Set();
  for (const key of dates) {
    if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error("祝日の日付が正しくありません。");
    const [year, month, day] = key.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    if (year < 1955 || year > 2099 || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day || unique.has(key)) {
      throw new Error("祝日の日付が正しくありません。");
    }
    unique.add(key);
    byYear.set(year, (byYear.get(year) || 0) + 1);
  }
  const years = [...byYear.keys()].sort((a, b) => a - b);
  for (const [index, year] of years.entries()) {
    if (byYear.get(year) < 12 || byYear.get(year) > 40 || !unique.has(`${year}-01-01`) || !unique.has(`${year}-11-23`) || (index && year !== years[index - 1] + 1)) {
      throw new Error("祝日データが不足しているため更新できません。");
    }
  }
  return { dates: [...unique].sort(), years };
}

export function getHolidayUpdate(storage) {
  try {
    const raw = storageOrDefault(storage)?.getItem(HOLIDAY_UPDATE_KEY);
    if (raw === cachedRaw) return cachedValue;
    cachedRaw = raw;
    cachedValue = null;
    if (!raw || raw.length > 300000) return null;
    const value = JSON.parse(raw);
    if (value.version !== 1 || value.source !== HOLIDAY_UPDATE_URL || !Number.isFinite(Date.parse(value.checkedAt)) || typeof value.baseline !== "string") return null;
    const validated = validateHolidayDates(value.dates);
    cachedValue = { ...value, ...validated, holidays: new Set(validated.dates) };
    return cachedValue;
  } catch (_error) {
    return null;
  }
}

export async function updateHolidayData({ fetcher = globalThis.fetch, storage, now = new Date() } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetcher(HOLIDAY_UPDATE_URL, { cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal: controller.signal });
    if (!response.ok) throw new Error("祝日データを取得できませんでした。通信状態を確認してください。");
    const text = await response.text();
    if (text.length > 300000) throw new Error("祝日データの形式が正しくありません。");
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data) || Object.values(data).some((name) => typeof name !== "string" || !name.trim() || name.length > 120)) {
      throw new Error("祝日データの形式が正しくありません。");
    }
    const validated = validateHolidayDates(Object.keys(data));
    if (![now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].every((year) => validated.years.includes(year))) {
      throw new Error("前年・今年・翌年の祝日データがそろっていないため更新できません。");
    }
    const targetStorage = storageOrDefault(storage);
    const previous = getHolidayUpdate(targetStorage);
    const before = previous?.baseline === BUNDLED_HOLIDAY_REVISION
      ? previous.dates.filter((date) => validated.years.includes(Number(date.slice(0, 4))))
      : [...JAPANESE_HOLIDAYS].filter((date) => validated.years.includes(Number(date.slice(0, 4)))).sort();
    const changed = before.join(",") !== validated.dates.join(",");
    const record = { version: 1, source: HOLIDAY_UPDATE_URL, baseline: BUNDLED_HOLIDAY_REVISION, checkedAt: now.toISOString(), dates: validated.dates };
    // Persist first: failed downloads or storage errors never replace the current calendar.
    targetStorage.setItem(HOLIDAY_UPDATE_KEY, JSON.stringify(record));
    return { changed, checkedAt: record.checkedAt, years: validated.years };
  } finally {
    clearTimeout(timer);
  }
}
