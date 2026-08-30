---
name: rebalance
description: 保有 portfolio + cash を踏まえて Hold/Trim/Sell/Add と新規 Buy を提案するとき。3 ヶ月おきの中長期レビューに使う。「rebalance したい」「ポートフォリオ見直したい」「cash どう使う」などに使う。
---

# rebalance — Portfolio Rebalance

## いつ使う

- 3 ヶ月おきの中長期 portfolio レビュー
- 「rebalance したい」「ポートフォリオ見直したい」
- 「cash どう使う」「何を売って何を買う」

## 事前確認（必須）

### ユーザーが Monthly Statement Transactions をアップロードした場合（推奨フロー）

Wealthsimple の **Monthly Statement Transactions CSV**（例: `TFSA-monthly-statement-transactions-XXXX-YYYY-MM-01.csv`）を 1 ファイル渡してもらえれば、portfolio.csv と cash.csv の両方を同期できる。

```bash
# dry-run でまず確認
bun run scripts/investment/import-monthly-statement.ts --monthly <path> --dry-run

# 問題なければ本番
bun run scripts/investment/import-monthly-statement.ts --monthly <path>
```

同期内容:

- **portfolio.csv**: ファイル内の BUY/SELL を quantity delta として加算。BUY は avg_cost を加重平均で再計算、SELL は avg_cost 保持。新規 ticker は自動追加、quantity 0 になった ticker は除外
- **cash.csv**: ファイル末尾の per-currency balance を期末残高として採用（USD/CAD それぞれ最後の balance 値）
- **DIV / NRT / FEE / LOAN / RECALL / FPLINT**: cash balance には反映済みなので追加処理は不要

重複適用防止:

- 処理済み statement の period_end（= ファイル内最大日付）を `aspects/investment/.last-import.json` に記録
- period_end が記録値以前なら自動 SKIP（同じ月を 2 回 import しても二重カウントしない）
- 複数月を順に取り込みたい場合は古い月から実行する

ユーザーが「複数の monthly を持ってる」と言ったら、古い順に 1 ファイルずつ実行する。

### ユーザーが Activities Export + Holdings Report をアップロードした場合

Wealthsimple の **Activities Export CSV**（`activities-export-YYYY-MM-DD.csv`）と **Holdings Report CSV**（`holdings-report-YYYY-MM-DD.csv`）を両方渡してもらえれば、portfolio.csv を同期できる。

```bash
# dry-run でまず確認（必須）
bun run scripts/investment/import-wealthsimple-export.ts \
  --activities <activities.csv> --holdings <holdings.csv> --dry-run

# cash 増分を計上する場合
bun run scripts/investment/import-wealthsimple-export.ts \
  --activities <activities.csv> --holdings <holdings.csv>

# cash は触らず portfolio だけ更新する場合（売却分は別用途）
bun run scripts/investment/import-wealthsimple-export.ts \
  --activities <activities.csv> --holdings <holdings.csv> --skip-cash
```

同期内容:

- **portfolio.csv**: holdings-report を source of truth として全置換。quantity = Quantity、avg_cost = Book Value (Market) / Quantity。holdings に無い ticker は除外
- **cash.csv**: 既存 cash.csv の `updated_on` 以降の `net_cash_amount` 合計を delta として加算

#### cash 増分の確認は必須（厳守）

**activities-export の SELL proceeds 合算を「cash が増えた」と自動的に仮定してはいけない。** ユーザーは売却金を別用途（出金・別口座移動）に使うことがあるため、cash 残高は確認なしには増加させない。

手順:

1. `--dry-run` を実行して USD/CAD の cash delta を表示する
2. delta が +0 でない場合、**必ずユーザーに「この cash 増分は計上していい？」と確認する**
3. ユーザーが「cash 入ってない」「売却分は使わない」「別用途」などと答えたら `--skip-cash` で再実行する
4. 「合ってる」と答えたら通常実行する

**過去のミス（2026-06-04）:** activities-export の SELL proceeds +$2,886.43 を確認せずに cash.csv に書き込もうとした。ユーザーは売却分を別用途に使う前提だったため指摘された。

### Monthly Statement をアップロードしない場合

1. `aspects/investment/portfolio.csv` が存在するか確認
   - 無ければ `docs/superpowers/specs/2026-05-21-investment-portfolio-csv-design.md` を見せて作成を促す
2. `aspects/investment/cash.csv` が存在するか確認
   - 無ければサンプル schema を出して作成を促す
3. `cash.csv` の `updated_on` を確認
   - 30 日以上前なら「Wealthsimple を見て cash 残高を更新しますか？」と聞く

## BUY/ADD は cash 前提にしない（厳守）

**cash.csv の残高が $0 でも BUY/ADD 候補を評価する。** TRIM/SELL で生まれる proceeds が可処分資金になる。

- `rebalance.ts` が TRIM 合計を自動計算して `allocate-cash.ts` に渡す
- 「cash $0 だから BUY/ADD なし」とショートカットしない

## メタトレンド判断軸

`/rebalance` は単なる目標比率への復元ではなく、メタトレンド仮説のレビューとして扱う。

- 各保有銘柄について「どの 10 年級メタトレンドに乗るか」を確認する
- winner 候補は、含み益が大きいだけでは売らない
- 売却・縮小理由は、仮説崩壊、過集中、短期急落 + 悪材料、より強い機会への資金移動に限定する
- 新規 BUY / ADD は、メタトレンド仮説、牽引企業としての根拠、仮説が壊れる条件を明記する
- テーマ性だけで実需・収益化が弱い候補は、見送りまたは Edge Lottery の小サイズに制限する

## 実行

```bash
# dry-run でまず確認
bun run scripts/investment/rebalance.ts --dry-run

# 問題なければ本番（md 保存 + Notion 登録）
bun run scripts/investment/rebalance.ts
```

## 出力

- `aspects/investment/reports/YYYY-MM-DD-rebalance.md`（gitignored）
- Notion DB「Portfolio Rebalance」に 1 ページ

## 結果のレビュー

実行後、以下をユーザーに確認:

1. sanity-check 警告銘柄があれば、最初に伝える（🚨 ticker）
2. 推奨 actions の Summary（BUY n / ADD n / HOLD n / TRIM n / SELL n）
3. **各 BUY/ADD に「未来予想図」を必ず添える（厳守）**
   - 「なぜこれから上がるか」を 2-3 文で語る（シナリオ・トリガーを明示）
   - 数字の羅列だけで終わらない。「いつ・何が起きたとき・どう再評価されるか」まで語る
   - 例: 「2027年にTSMCのN2量産が本格化した瞬間、工程数増加 → RF電源需要増 → AEISへの連想が広がる」
4. Cash Allocation の最終形（金額を明記）
5. **次回レビュー推奨時期を伝える（厳守）**
   - 固定「3ヶ月後」は禁止。保有銘柄の直近カタリストから最も近い重要イベントを特定して提示する
   - 対象イベント例: 決算発表・製品量産開始・打ち上げウィンドウ・規制判断・パートナー契約発表等
   - 複数ある場合は最短のものを次回目安とし、「なぜそのタイミングか」を一言添える
   - 例: 「次回は7月上旬推奨。RKLB Neutron 打ち上げウィンドウ + CRWD 決算前に thesis を再確認する」
6. 「実際に発注しますか？」とは聞かない（ユーザーが Wealthsimple で手動発注する）

### ⚠️ BUY/ADD をユーザーに提示する前に必ず通すフィルタ（厳守）

**① バケット充足チェック（最優先）**

現在の保有をざっくり分類して不足バケットを特定する：

| バケット | 目標 | 不足なら優先度 |
|---------|------|--------------|
| Edge Core（NVDA/MSFT/AMZN/GOOG 等 mega-cap） | 35-40% | 中（ADD で対応） |
| Edge Lottery（mid/small-cap pre-breakout） | 10-15% | 中 |
| **Diversifier Growth**（非 AI 成長株） | **15-20%** | **高（Cash を優先投下）** |
| **Defensive Value**（配当・バリュー） | **10-15%** | **高（Cash を優先投下）** |
| Cash | 5-10% | — |

Diversifier/Defensive が不足しているのに Edge をさらに積むのは誤り。

**② マクロ文脈（Cash 保持水準）**

Cash を「多すぎ＝悪」と自動判定しない。以下が重なる場合は Cash 20-30% 維持を推奨する：
- 主要保有銘柄の 3m リターンが複数 +80% 超（市場過熱）
- BUY 候補の大半が 1m+50% 超（モメンタム追い）
- Fed/マクロ不確実性が高い

**③ BUY 品質フィルタ**

1. **新規 BUY は最大 3 件**。超える場合は confidence 高い順に絞り、残りは「次回候補」と明記
2. **テーマ重複禁止**：同一メタトレンドに複数の新規 BUY は 1 銘柄に絞る
3. **ポジション総数**：現保有 + 新規 BUY が 20 超なら絞る
4. **Thesis 品質**：「なぜこの会社が勝つか（競合でなくこの会社の理由）」と「仮説崩壊条件」が明示されているか確認
5. **データ品質**：ニュースリンクの企業名が ticker と一致しているか確認（ミスマッチは除外）

## 新規候補の取り込み

`aspects/investment/candidates/` に discovery skill の出力（`YYYY-MM-DD-<strategy>.json`）があれば自動で取り込まれる。14 日以上前のファイルは無視される。

discovery skill は別途実装予定（`/discover-growth` 等）。MVP 時点では存在しない。

## 関連 spec

- 設計: [docs/superpowers/specs/2026-05-21-portfolio-rebalance-command-design.md](../../docs/superpowers/specs/2026-05-21-portfolio-rebalance-command-design.md)
- 実装プラン: [docs/superpowers/plans/2026-05-21-portfolio-rebalance-command.md](../../docs/superpowers/plans/2026-05-21-portfolio-rebalance-command.md)
