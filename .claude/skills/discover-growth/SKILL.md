---
name: discover-growth
description: 新規の growth 候補銘柄をニュース起点で発掘するとき。「新しい買い候補ない？」「グロース株探して」「次のリバランスの弾」などに使う。出力は /rebalance が次回自動取り込みする。
---

# discover-growth — Growth 候補発掘

## いつ使う

- 「新しい買い候補ない？」「グロース株探して」
- 「次の /rebalance までに候補を仕込んでおきたい」
- portfolio が tech 偏重で別テーマを探したい
- cash drag があって BUY 候補が欲しい

## 動作

1. `aspects/investment/portfolio.csv` を読んで保有銘柄を **除外リスト**にセット
2. RSS ニュース取得 (Bloomberg / Yahoo / MarketWatch / CNBC / Seeking Alpha)
3. Claude が news から growth 候補を 12 個ピック（保有除外、テーマ性 + カタリスト基準）
4. yahoo-finance2 でファンダ + 価格履歴 + per-ticker ニュース取得
5. sanity-check で暴落銘柄を除外
6. Claude が最終 5 銘柄に絞り込み、confidence Med 以上を採用
7. `aspects/investment/candidates/<YYYY-MM-DD>-growth.json` に出力

## 実行

```bash
# 本番（JSON 出力）
bun run scripts/investment/discover-growth.ts

# dry-run（stdout のみ）
bun run scripts/investment/discover-growth.ts --dry-run

# 採用銘柄数を変更（default 5）
bun run scripts/investment/discover-growth.ts --n 8
```

## 出力フォーマット

```json
{
  "generated_at": "2026-05-21T09:00:00.000Z",
  "strategy": "growth",
  "excluded_tickers": ["AAPL", "AMZN", ...],
  "candidates": [
    {
      "ticker": "TSM",
      "thesis": "...",
      "confidence": "High",
      "recent_news": [{"date": "2026-05-18", "headline": "...", "url": "..."}],
      "sources": ["https://..."]
    }
  ]
}
```

## 次の流れ

discover-growth 実行後:

1. JSON の内容を確認（特に thesis と news の質）
2. 妥当なら `/rebalance` を実行 → JSON が自動取り込みされて BUY 候補として cash 配分対象に
3. JSON は 14 日以内のものだけ /rebalance が読む（古いものは無視）

## 評価軸

- **直近 30 日のニュース・カタリスト**（最優先）
- テクニカル / 価格モメンタム (3/6/12 ヶ月リターン、drawdown)
- 売上成長率・テーマ性（AI / semis / 宇宙 / バイオ / クリーンエネルギー / 核融合 / 防衛等）
- **市場規模: $1B-$20B mid/small-cap が sweet spot**（「次の主役」「これからの芽」候補）
  - $50B+ メガキャップは採用 0-1 銘柄まで（既に走り終わってる）
  - $5B-$20B が特に好み (pre-breakout 段階、機関ホルダー余地あり)
- バリュー指標は **下値リスクスクリーニング** のみで選好理由ではない

## 関連ファイル

- 設計: [docs/superpowers/specs/2026-05-21-portfolio-rebalance-command-design.md](../../docs/superpowers/specs/2026-05-21-portfolio-rebalance-command-design.md#新規候補の-pluggable-interface別-skill-用)
- スクリプト: [scripts/investment/discover-growth.ts](../../scripts/investment/discover-growth.ts)
- 連携先: [/rebalance](../rebalance/SKILL.md)
