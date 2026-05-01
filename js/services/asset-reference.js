import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "../platform/firebase.js";
import { isLocalMode, storageGetItem, storageSetItem } from "../platform/local-db.js";

const LOCAL_STORAGE_KEY = "monthlyApplianceBook.assetReferenceData";
const REFERENCE_DOC_ID = "__assetReferenceData";
const REFERENCE_SOURCE_TYPE = "assetReferenceData";
const REFERENCE_SCHEMA_TYPE = "assetValuationReference";

export const ASSET_REFERENCE_SOURCE = {
  title: "耐久消費財の耐用年数，評価に用いる単価及び取得時期別残価率",
  target: "二人以上の世帯",
  url: "https://www.stat.go.jp/data/zensho/2014/pdf/assetest4.pdf",
};

const DEFAULT_KEYWORDS = {
  "システムキッチン": ["システムキッチン"],
  "太陽熱温水器": ["太陽熱温水器"],
  "洗髪洗面化粧台": ["洗髪洗面化粧台", "洗面化粧台"],
  "温水洗浄便座": ["温水洗浄便座", "ウォシュレット"],
  "床暖房": ["床暖房"],
  "太陽光発電システム": ["太陽光発電", "太陽光発電システム"],
  "高効率給湯器": ["高効率給湯器", "給湯器"],
  "家庭用コージェネレーションシステム": ["コージェネレーション", "エネファーム"],
  "家庭用エネルギー管理システム": ["HEMS", "エネルギー管理システム"],
  "電子レンジ（電子オーブンレンジを含む）": ["電子レンジ", "オーブンレンジ"],
  "自動炊飯器（遠赤釜・ＩＨ型）": ["炊飯器", "自動炊飯器"],
  "冷蔵庫": ["冷蔵庫"],
  "電気掃除機": ["掃除機", "電気掃除機"],
  "洗濯機": ["洗濯機"],
  "ＩＨクッキングヒーター": ["IHクッキングヒーター", "ＩＨクッキングヒーター"],
  "食器洗い機": ["食器洗い機", "食洗機"],
  "ホームベーカリー": ["ホームベーカリー"],
  "ルームエアコン": ["エアコン", "ルームエアコン"],
  "空気清浄機": ["空気清浄機"],
  "たんす(作り付けを除く)": ["たんす", "タンス"],
  "食堂セット（食卓と椅子のセット）": ["食堂セット", "食卓", "ダイニングセット"],
  "食器戸棚(作り付けを除く)": ["食器戸棚", "食器棚"],
  "サイドボード･リビングボード": ["サイドボード", "リビングボード"],
  "鏡台(ドレッサー)": ["鏡台", "ドレッサー"],
  "ＬＥＤ照明器具(電球・蛍光灯を除く)": ["LED照明", "ＬＥＤ照明", "照明器具"],
  "ベッド･ソファーベッド(作り付けを除く)": ["ベッド", "ソファーベッド"],
  "電動アシスト自転車": ["電動アシスト自転車", "電動自転車"],
  "カーナビゲーションシステム": ["カーナビ", "カーナビゲーション"],
  "スマートフォン": ["スマホ", "スマートフォン"],
  "携帯電話(PHSを含み，ｽﾏｰﾄﾌｫﾝを除く)": ["携帯電話", "ガラケー", "PHS"],
  "テレビ": ["テレビ", "TV"],
  "ビデオレコーダー(DVD・ﾌﾞﾙｰﾚｲを含む)": ["ビデオレコーダー", "DVD", "Blu-ray", "ブルーレイ"],
  "ﾎｰﾑｼｱﾀｰ(ﾌﾟﾛｼﾞｪｸﾀｰ,ｽｸﾘｰﾝ,ｽﾋﾟｰｶｰのｾｯﾄ)": ["ホームシアター", "プロジェクター"],
  "パソコン(デスクトップ型)": ["デスクトップ", "デスクトップPC"],
  "パソコン(ノート型(ﾓﾊﾞｲﾙ・ﾈｯﾄﾌﾞｯｸを含む))": ["ノートPC", "ノートパソコン", "ラップトップ"],
  "タブレット端末": ["タブレット", "タブレット端末"],
  "カメラ": ["カメラ", "デジタルカメラ"],
  "ビデオカメラ": ["ビデオカメラ"],
  "ピアノ・電子ピアノ": ["ピアノ", "電子ピアノ"],
  "書斎・学習用机(ﾗｲﾃｨﾝｸﾞﾃﾞｽｸを含む)": ["学習机", "書斎机", "デスク"],
};

function userReferenceDocRef(uid) {
  return doc(db, "users", uid, "durableGoodsItems", REFERENCE_DOC_ID);
}

function parseNumber(value) {
  const number = Number(String(value ?? "").replaceAll(",", ""));
  return Number.isFinite(number) ? number : null;
}

function defaultKeywordsFor(label) {
  const keywords = DEFAULT_KEYWORDS[label] ?? [];
  return [...new Set([label, ...keywords].filter(Boolean))];
}

function normalizeReferenceItem(item) {
  const usefulLifeYears = parseNumber(item?.usefulLifeYears);
  const unitPrice = parseNumber(item?.unitPrice);
  if (!item?.code || !item?.label || !usefulLifeYears || !unitPrice) return null;

  const keywords = Array.isArray(item.keywords) ? item.keywords : defaultKeywordsFor(item.label);
  return {
    code: String(item.code).padStart(2, "0"),
    label: String(item.label),
    usefulLifeYears,
    unitPrice,
    keywords: [...new Set(keywords.map(String).filter(Boolean))],
  };
}

function normalizeReferenceData(data) {
  const items = Array.isArray(data?.items)
    ? data.items.map(normalizeReferenceItem).filter(Boolean)
    : [];

  return {
    source: {
      ...ASSET_REFERENCE_SOURCE,
      ...(data?.source && typeof data.source === "object" ? data.source : {}),
    },
    importedAt: data?.importedAt ?? null,
    items,
  };
}

function firestoreValueToReferenceData(data) {
  return normalizeReferenceData(data);
}

function localStorageValueToReferenceData(value) {
  if (!value) return null;
  try {
    return normalizeReferenceData(JSON.parse(value));
  } catch (_error) {
    return null;
  }
}

export function parseAssetReferenceText(text) {
  const items = [];
  const seenCodes = new Set();
  const lines = String(text ?? "").split(/\r?\n/);
  const itemPattern = /^(\d{2})\s+(.+?)\s+([0-9]+|-)\s+(?:[0-9.]+|-)\s+(?:[0-9.]+|-)\s+(?:[0-9.]+|-)\s+([0-9,]+|購入価格)\s+/;

  for (const line of lines) {
    const match = line.trim().match(itemPattern);
    if (!match) continue;

    const [, code, label, usefulLifeText, unitPriceText] = match;
    if (seenCodes.has(code)) continue;
    if (usefulLifeText === "-" || unitPriceText === "購入価格") continue;

    const item = normalizeReferenceItem({
      code,
      label,
      usefulLifeYears: usefulLifeText,
      unitPrice: unitPriceText,
      keywords: defaultKeywordsFor(label),
    });
    if (!item) continue;

    seenCodes.add(code);
    items.push(item);
  }

  if (items.length === 0) {
    throw new Error("インポートできる行が見つかりませんでした。二人以上の世帯の表テキストを貼り付けてください。");
  }

  return {
    source: ASSET_REFERENCE_SOURCE,
    importedAt: new Date().toISOString(),
    items,
  };
}

export async function loadAssetReferenceData(uid) {
  if (isLocalMode()) {
    return localStorageValueToReferenceData(storageGetItem(LOCAL_STORAGE_KEY));
  }

  if (!uid) return null;
  const snapshot = await getDoc(userReferenceDocRef(uid));
  if (!snapshot.exists()) return null;
  const data = snapshot.data();
  if (data.sourceType !== REFERENCE_SOURCE_TYPE) return null;
  return firestoreValueToReferenceData(data);
}

export async function saveAssetReferenceData(uid, data) {
  const normalizedData = normalizeReferenceData({
    ...data,
    importedAt: data.importedAt ?? new Date().toISOString(),
  });

  if (isLocalMode()) {
    storageSetItem(LOCAL_STORAGE_KEY, JSON.stringify(normalizedData));
    return normalizedData;
  }

  if (!uid) {
    throw new Error("参照データの保存にはログイン情報が必要です。");
  }

  await setDoc(userReferenceDocRef(uid), {
    ...normalizedData,
    sourceType: REFERENCE_SOURCE_TYPE,
    schemaType: REFERENCE_SCHEMA_TYPE,
    updatedAt: serverTimestamp(),
  });
  return normalizedData;
}
