---
name: meal
description: 食事を記録するとき。「〇〇食べた」「朝食記録したい」「ご飯ログ」など食事トラッキングに使う。daily ファイル・Notion meals DB・fridge.md を一括更新する。
---

# Meal - 食事記録

食事を素早く記録する。daily ファイル・Notion meals DB・fridge.md を一括更新。

## 引数

$ARGUMENTS — 食べたもの（省略可。省略時は対話モード）

## Step 1: 現在時刻と状況を確認する

```bash
TZ=Asia/Tokyo date "+%Y-%m-%d %H:%M %a"
```

- 今日の daily ファイル（`aspects/diet/daily/YYYY-MM-DD.md`）を読む
- `aspects/diet/fridge.md` を読む
- `aspects/diet/nutrition-targets.md` — PFC概算の基準値テーブル

## Step 2: 食事内容を特定する

**引数ありの場合:**
- 引数をそのままメニューとして使う
- 食事枠（朝/昼/夕）は現在時刻から推定し、ユーザーに確認する

**引数なしの場合:**
- 「何食べた？」と聞く
- ユーザーの回答を待つ

**時刻の推定基準:**
- 〜10:00 → 朝食
- 10:00〜15:00 → 昼食
- 15:00〜 → 夕食

## Step 3: 食事の種類を判別する

| 種類 | 判定基準 | レシピ | kcal | PFC |
|------|----------|--------|------|-----|
| 自炊（新規） | 献立にあるメニュー or 食材から調理 | `notion-add.ts` で自動生成 | レシピから算出 | 材料から概算 |
| 残り物・簡易 | 「残り」「パン」「オートミール」「納豆」等 | `--no-recipe` | 概算 | 主要食材から概算 |
| コンビニ・購入品 | 「コンビニ」「カップ」「おにぎり」等 | `--no-recipe` | 一般値で概算 | コンビニ基準値で概算 |
| 外食 | 「外食」「〇〇と」「飲み会」等 | `--no-recipe` | `—` | `P: — \| F: — \| C: —` |

PFC概算には `nutrition-targets.md` の「PFC概算の基準値」テーブルを使用する。テーブルにない食材は一般的な栄養価から概算。

## Step 4: 時制を判別する

- **過去形**（「食べた」「済ませた」）→ ステータス: 完了
- **未来形**（「食べる」「これから」）→ ステータス: 未着手
- **引数のみ（時制不明）** → 「もう食べた？」と確認

## Step 5: 一括登録（確認なしで自動実行）

### 5a. daily ファイル更新

`aspects/diet/daily/YYYY-MM-DD.md` の該当食事セクションを追加・更新する。**PFC値も必ず記載する。**

フォーマット:

```
## 昼食 12:00-13:00
メニュー名
- 材料1 量
- 材料2 量
- ~XXX kcal | P: XXg | F: XXg | C: XXg
```

日次サマリーも再計算する:

```
**合計: ~XXXX kcal | P: XXXg | F: XXg | C: XXXg**
**目標比: P: XX% | F: XX% | C: XX%**
```

目標比は `nutrition-targets.md` の日次目標から算出する。外食（`P: —`）は合計・目標比の計算から除外する。

### 5b. Notion meals DB に登録

```bash
# 自炊（レシピあり）
bun run scripts/notion/notion-add.ts --db meals --title "メニュー名" --date YYYY-MM-DD --start HH:MM --end HH:MM

# 残り物・コンビニ・外食（レシピなし）
bun run scripts/notion/notion-add.ts --db meals --title "メニュー名" --date YYYY-MM-DD --start HH:MM --end HH:MM --no-recipe
```

完了済みの場合は `--status 完了` をつける。

**`--no-recipe` でも自炊・簡易調理なら本文に準備手順を書く（厳守）:**
- 登録後 `notion-update-page`（`replace_content`）で材料・手順を簡潔に書く
- 外食・コンビニ・購入品のみ本文なしOK

### 5c. fridge.md 更新

食べたものに含まれる食材を `fridge.md` から減算する:
- 数量を減らす（例: 2食分 → 1食分）
- 0 になったら `**要補充**` に変更するか行を削除
- 外食・コンビニの場合は fridge 更新不要

### 5d. 既存エントリの差し替え

daily ファイルに同じ食事枠（朝/昼/夕）の予定メニューが既にある場合:
- daily のメニューを実際のものに書き換える
- Notion の元エントリを `notion-delete.ts` で削除してから新規登録
- `aspects/diet/CLAUDE.md` の「予定していた食事を食べなかった場合」のフローに従う

## Step 6: 報告（1-2行で簡潔に）

```
記録した。昼食: パスタ残り + 食パン2切れ（約550kcal | P: 18g F: 12g C: 75g）。fridge: パスタ残り 2→1食分、食パン 2→0枚。
```

## 注意

- **全 Step を1回のレスポンスで完了させる。** Step 1 だけで止まらない
- 時間帯の重複チェック: 同じ時間に既存エントリがあれば確認する
- 食事の所要時間は原則1時間で登録する（CLAUDE.md ルール）
- NG 食材チェック: `profile/health.md` 参照（トマト、マヨネーズ、ケチャップ、マスタード）
- カロリー・PFC概算: `nutrition-targets.md` の「PFC概算の基準値」を参照。テーブルにない食材は一般的な栄養価で概算する

## 食事メニュー変更時は本文も更新する（厳守）

- `update_properties` でタイトル（名前）を変更しただけでは、ページ本文（レシピ等）は旧メニューのまま残る
- **一品の追加・削除も同じ。** タイトルから料理名を抜いた/足した場合も、本文のレシピを必ず更新する
- **原則: タイトルを変更したら、必ず本文も確認・更新する**
- **正しい手順:** `update_properties` でタイトル変更 → `notion-fetch` で本文確認 → `replace_content` で本文を新メニューに差し替え
