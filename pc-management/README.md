# パソコン管理

パソコン管理は、パーツ1件をライフサイクル年表の帯1本として管理する画面です。
データは Firestore の `users/{uid}/durableGoodsItems` に保存しますが、`sourceType: "pcManagement"` で判別し、ライフサイクルコスト側の金額集計や年表には連携しません。
旧PC単位データは移行せず、`dataVersion: 7` かつ `schemaType: "pcPartLifecycle"` のパーツ単位データだけを表示対象にします。

## ファイル構成

```text
pc-management/
  index.html
  form.html
  hidden.html
  app.js
  README.md
```

## 入力項目

- 商品名（パーツ）
- 型番
- 分類（パソコン名: メインPC、サブPC）
- スペック（詳細入力欄）
- 購入日
- 購入価格
- 使用年数
- 使用終了日
- 月額コスト
- 帯を表示しない

## 年表表示

通常の `index.html` では、`帯を表示しない` にチェックしていないパーツだけを表示します。
`hidden.html` では、`帯を表示しない` にチェックしたパーツだけを表示します。

帯の色はパソコン名で切り替えます。

- メインPC: 緑系
- サブPC: 青系

## データ例

```json
{
  "dataVersion": 7,
  "schemaType": "pcPartLifecycle",
  "sourceType": "pcManagement",
  "category": "pc",
  "name": "CPU",
  "itemName": "CPU",
  "partName": "CPU",
  "model": "Ryzen 7 7800X3D",
  "modelNumber": "Ryzen 7 7800X3D",
  "pcName": "main",
  "specDetail": "8コア16スレッド",
  "purchaseDate": "2026-04-21",
  "price": 48000,
  "purchasePrice": 48000,
  "yearsOfUse": 5,
  "endOfUseDate": "",
  "hideFromTimeline": false,
  "monthlyCost": 800,
  "additionalCosts": []
}
```
