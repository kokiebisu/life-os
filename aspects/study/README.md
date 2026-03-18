# Study - 学習管理

起業・法律・技術の学習を、各分野のメンターチームがサポートします。

## メンター一覧

### 起業メンター

| メンター | ファイル | 専門領域 |
|----------|----------|----------|
| Paul Graham | `team/graham.md` | スタートアップの本質、エッセイ、初期のアイデア検証 |
| Sam Altman | `team/altman.md` | スケーリング、資金調達、リーダーシップ |
| Michael Seibel | `team/seibel.md` | アーリーステージ、MVP、ユーザーヒアリング |
| Brian Chesky | `team/chesky.md` | プロダクトデザイン、カルチャー、ユーザー体験 |
| Jason Fried | `team/fried.md` | ブートストラップ、少人数経営、リモートワーク |

### 法律メンター

| メンター | ファイル | 専門領域 |
|----------|----------|----------|
| 西村 法子 | `team/nishimura.md` | 法人設立、契約書、知的財産、労務、税務 |

### 技術メンター

| メンター | ファイル | 専門領域 |
|----------|----------|----------|
| Martin Fowler | `team/fowler.md` | リファクタリング、アーキテクチャ、設計パターン |
| Kelsey Hightower | `team/hightower.md` | クラウドネイティブ、Kubernetes、インフラ |
| Will Larson | `team/larson.md` | Staff+ キャリア、エンジニアリング組織設計 |

## 活用方法

### 相談の仕方

`/ask:study` コマンドで学習チームに相談できます。質問内容に応じて、適切なメンターの視点からアドバイスを受けられます。

### 相談例

- 「個人開発プロダクトを事業化したいが、何から始めればいい？」→ Graham, Seibel, Fried の視点
- 「法人設立に必要な手続きは？」→ 西村法子の視点
- 「マイクロサービスに移行すべきか？」→ Fowler, Hightower の視点
- 「シニアエンジニアの次のキャリアパスは？」→ Larson の視点
- 「VCから資金調達すべきか、ブートストラップすべきか？」→ Altman vs Fried の視点

### アルゴリズム学習

CS基礎・面接対策・実務応用を統合したアルゴリズム学習は `algorithms/README.md` を参照。

### 学習ロードマップ

段階的な学習計画は `roadmap.md` を参照してください。

## 学習セッションの記録

`/study` コマンドで学習セッションを開始できます。

- Notion Study DB にセッションを登録（カレンダー連携）
- Claude と対話しながらコーネル式ノートを記録
- ローカル MD と Notion ページを同期管理
- ファイルパス: `aspects/study/{category}/notes/YYYY-MM-DD-{book-slug}.md`

### 使い方

```
/study                          # 対話式でカテゴリ・時刻を確認
/study algorithms               # カテゴリ指定
/study algorithms --start 14:00 # 開始時刻も指定
```
