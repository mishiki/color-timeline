# Color Timeline v0.1.0

動画・静止画の最大5色と面積比を表示し、動画の配色をタイムラインに蓄積する初回プロトタイプです。

- Web版: https://mishiki.github.io/color-timeline/
- ローカル版: 下記の color-timeline.zip を展開。Node.js 20以降を用意し、Windowsは start.cmd、Linux/macOSは bash start.sh を実行してください。
- 動画・画像の選択とドラッグ＆ドロップ、再生中の解析、時刻サンプリングによる先読み解析。
- 解析結果をブラウザーのIndexedDBに保存。JSON・CSV・PNG出力。
- 元動画・画像のアップロードや永続的な複製は行いません。

Web版とローカル版の保存領域は別です。結果の移行にはJSONを使ってください。
Chrome / Edgeのデスクトップ版を主な対象としています。対応する動画形式はブラウザーに依存します。先読みは全フレームデコードではなく、処理速度の保証はありません。抽出色の妥当性は利用者による評価の対象です。
