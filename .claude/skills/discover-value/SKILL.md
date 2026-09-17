---
name: discover-value
description: 新規の value (割安) 候補銘柄をニュース起点で発掘するとき。「割安株探して」「value 候補出して」「次のリバランスのバリュー枠」などに使う。出力は /rebalance が次回自動取り込みする。
---

# discover-value — Value 候補発掘

## いつ使う

- 「割安株探して」「value 候補出して」
- 「次の /rebalance までにバリュー枠を仕込みたい」
- portfolio が growth 偏重で value バランスを足したい
- discover-growth と組み合わせて両軸の候補を持ちたい

## /discover-growth との違い

| | discover-growth | discover-value |
|---|---|---|
| 主軸 | カタリスト・モメンタム・売上成長率 | 割安性 (PER/PBR/FCF yield/配当) |
| 高 PER | 許容（成長率が裏付けるなら） | NG（売却シグナル） |
| 価格モメンタム | 強いほど好み | 関係なし、底値近辺好み |
| セクター傾向 | AI/semis/宇宙等の grow テーマ | 消費財・金融・ヘルスケア・産業財・公益等 |
| Tech | 主戦場 | 避けるか少数 |

## 動作

1. `aspects/investment/portfolio.csv` を読んで保有銘柄を除外リストにセット
2. RSS ニュース取得
3. Claude が news から value 候補を 12 個ピック（保有除外、割安 + クオリティ基準）
4. yahoo-finance2 でファンダ + 価格 + per-ticker ニュース取得
5. sanity-check で暴落銘柄を除外（value トラップ予防）
6. Claude が 5 銘柄に絞り込み、confidence High/Med のみ採用
7. `aspects/investment/candidates/<YYYY-MM-DD>-value.json` に出力

## 実行

```bash
bun run scripts/investment/discover-value.ts            # 本番（JSON 出力）
bun run scripts/investment/discover-value.ts --dry-run  # stdout のみ
bun run scripts/investment/discover-value.ts --n 8      # 採用数指定（default 5）
```

## バリュートラップ対策

以下は自動で除外される:
- FCF マイナス銘柄
- 売上 / 利益縮小トレンド
- D/E 400 超
- 配当カット履歴
- earnings miss + ガイダンス下方修正の直近ニュース
- drawdown -25% 以上（構造的悪化の疑い）

## 関連ファイル

- スクリプト: [scripts/investment/discover-value.ts](../../scripts/investment/discover-value.ts)
- 姉妹 skill: [/discover-growth](../discover-growth/SKILL.md)
- 連携先: [/rebalance](../rebalance/SKILL.md)
- 既存類似: `scripts/investment/daily-report.ts` (1 テーマ集中、Notion 出力)
