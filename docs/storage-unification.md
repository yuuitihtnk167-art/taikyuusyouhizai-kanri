# ストレージ統合完了記録

## 概要

ローカル保存版と Firestore 版を別々に育てる運用をやめ、UI と業務ロジックを共通化したうえで、保存処理だけを差し替える構成へ整理した。

これにより、機能追加やバグ修正の主な変更点を共通コード側へ集約し、保存方式ごとの差分を最小化する。

## 背景

- 同じ機能を 2 系統で実装すると差分管理が難しくなる
- バグ修正や追加開発が二重作業になりやすい
- 将来的にローカル版と Firestore 版で機能差異が広がるリスクがある

## 完了した方針

- UI は共通化する
- データ整形や保存前後の業務ロジックは共通化する
- 保存方式の差分はストレージ層に閉じ込める
- Firestore 固有コードは `js/platform` と `js/storage` 配下に限定する

## 現在のフォルダ構成

```text
js/
  platform/
    firebase.js
    local-db.js
  services/
    auth.js
  storage/
    durable-items/
      firestore.js
      index.js
      local.js
      service.js
    pc-items/
      firestore.js
      index.js
      local.js
```

## 各レイヤーの責務

### `js/platform`

- `local-db.js`
  - IndexedDB を使ったローカル保存の基盤処理を持つ
  - ローカルモード判定と切替フラグ管理を持つ
- `firebase.js`
  - Firebase / Firestore / Auth の初期化を担当する

### `js/services`

- `auth.js`
  - 認証状態の監視を担当する
  - ローカルモード開始時の初期化と、Firestore 利用時のログイン / ログアウトを切り替える

### `js/storage/durable-items`

- `local.js`
  - 耐久消費財データのローカル保存実装
- `firestore.js`
  - 耐久消費財データの Firestore 保存実装
- `index.js`
  - ローカル保存と Firestore 保存の切替窓口
- `service.js`
  - 保存方式に依存しない正規化、並び順、保存前後処理を担当する

### `js/storage/pc-items`

- `local.js`
  - PC 管理データのローカル保存実装
- `firestore.js`
  - PC 管理データの Firestore 保存実装
- `index.js`
  - ローカル保存と Firestore 保存の切替窓口

## 切替方法

現時点の切替は、ビルド時の環境変数ではなくランタイム切替を採用している。

- ローカル版:
  - `local-db.js` が保持するローカルモードフラグを有効化する
  - `index.js` が `isLocalMode()` を見て `local.js` を選択する
- Firestore 版:
  - ローカルモードでなければ `firestore.js` を選択する

代表的な切替コードは以下の通り。

```js
import * as local from "./local.js";
import * as firestore from "./firestore.js";
import { isLocalMode } from "../../platform/local-db.js";

function activeStorage() {
  return isLocalMode() ? local : firestore;
}
```

## UI 側の扱い

UI 側は保存方式を直接意識しない。

- 一覧画面や入力画面は `service.js` または `storage/index.js` を通して保存処理を呼ぶ
- 画面側で `local` と `firestore` を直接分岐しない

この方針により、保存方式を差し替えても UI 側の修正範囲を抑えやすくなる。

## 影響範囲

- `js/form.js`
- `js/list.js`
- `js/login.js`
- `pc-management/app.js`
- `js/platform/*`
- `js/services/*`
- `js/storage/*`

## この構成で得られる効果

- 保存方式ごとの実装差分を局所化できる
- 共通機能の修正を 1 か所に寄せやすい
- ローカル中心で開発しつつ Firestore 側へ横展開しやすい
- 将来の同期機能や追加ストレージ方式にも拡張しやすい

## 補足

当初案ではビルド時の環境変数で保存方式を切り替える構想があったが、現行実装ではランタイム切替を採用している。

別ビルド公開が必要になった場合は、このストレージ分離構成を維持したまま、エントリーポイントやビルド設定でローカルモードの初期値を固定する形で拡張する。

## 完了日

2026-04-30
