# 自作PC管理

このフォルダーだけで動く、単体の自作PC管理アプリです。

## 使い方

耐久消費財管理アプリでログインした状態で `index.html` を開いて使います。データは Firestore の `users/{uid}/durableGoodsItems` に保存されます。

以前の localStorage 版で保存したデータがこのブラウザに残っていて、Firestore 側が空の場合は、初回表示時にFirestoreへ移行するか確認します。

## ファイル構成

```text
pc-management/
  index.html
  styles.css
  app.js
  README.md
```

## 入力方針

自作PCは最初から部品単位で購入して組み立てるため、初期購入費をまとめて入力するのではなく、CPU、GPU、マザーボード、メモリ、ストレージ、電源、モニター、OSなどを `parts` として入力します。

現在スペックは `parts` から自動生成します。同じ種類のパーツが複数ある場合は、購入日が新しいものを現在のパーツとして扱います。GPUは任意です。GPUパーツがない場合は、現在スペックでは「未搭載」と表示します。

## データ構造

将来、耐久消費財管理アプリへ連携しやすいように、共通化しやすい項目名を含めています。

```json
{
  "dataVersion": 6,
  "pcItems": [
    {
      "id": "uuid",
      "category": "pc",
      "sourceType": "pcManagement",
      "itemName": "メインPC",
      "usage": "development",
      "purchaseDate": "2026-04-21",
      "price": 250000,
      "yearsOfUse": 5,
      "monthlyCost": 4167,
      "specs": {
        "cpu": "Ryzen 7 7800X3D",
        "gpu": "GeForce RTX 4070",
        "motherboard": "B650",
        "memory": "32GB",
        "storage": "NVMe SSD 2TB",
        "power_supply": "750W Gold",
        "monitor": "27インチ 144Hz",
        "os": "Windows 11 Pro"
      },
      "parts": [
        {
          "id": "uuid",
          "partType": "cpu",
          "partName": "Ryzen 7 7800X3D",
          "purchaseDate": "2026-04-21",
          "price": 48000,
          "memo": "初期構成",
          "createdAt": 1776758400000
        }
      ],
      "createdAt": 1776758400000,
      "updatedAt": 1776758400000
    }
  ]
}
```

## 連携の考え方

- `category`, `itemName`, `purchaseDate`, `price`, `monthlyCost` は耐久消費財管理側へ渡しやすい共通項目です。
- `parts` はPC専用の部品購入データです。
- `specs` は `parts` から生成される現在スペックです。
- 保存先は `users/{uid}/durableGoodsItems/{pcId}` です。
- Firestoreへは既存フォームと同じトップレベル項目で保存します。
- PC管理アプリの詳細データは `model` と `additionalCosts.memo` 内のJSONで判別します。
- `JSON出力` と `JSON読込` で、別環境への移行や将来連携の検証ができます。
