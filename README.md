# ブイブイ運動会

## クレジット

- 実況音声: VOICEVOX:No.7

## 素材の生成（npm run assets）

キャラのドット・立ち絵（`public/assets/gen/`）はリポジトリに入っていない。各配布元から入手し、手元で生成する。利用規約は各配布元を参照。

| 素材 | 配布元 | 置き場所 |
|---|---|---|
| 32dot立ち絵（ドットの元） | 32dot立ち絵 https://www.nicovideo.jp/watch/sm37329313 | `~/Projects/tsuina_onitaiji/assets_src/images/32dot_ver16.3/32dot_tachie.psd`（`tools/make_dot.py` の固定パス。ver16.3 で確認） |
| 立ち絵 | Moiky氏 https://www.nicovideo.jp/watch/sm41885086 | 任意のフォルダ。直下にキャラごとのフォルダ（名前は `src/shared/chars.json` の `dir`）を置き、`MOIKY_DIR` で指定 |

```
npm install
python3 -m venv ../assets-venv && ../assets-venv/bin/pip install psd-tools pillow
export MOIKY_DIR=<Moiky氏の立ち絵フォルダ>
PY=../assets-venv/bin/python npm run assets
```

`~/.zshrc` などに `export MOIKY_DIR=...` を書いておけば毎回の指定は不要。

### うまくいかないとき

| 症状 | 原因 | 対処 |
|---|---|---|
| 起動はするが、選択画面の立ち絵が壊れた画像アイコン、試合中のキャラが緑の斜線入りの黒い四角。コンソールに `Failed to process file: image "hanamaru_idle"`・`Texture "hanamaru_walk1" not found` | `public/assets/gen/` が無い（clone直後） | 上の手順で `npm run assets` |
| `ModuleNotFoundError: No module named 'psd_tools'` | `PY` 未指定でシステムの python3 が使われた、または psd-tools 未導入 | `PY=` に psd-tools・pillow を入れた Python を指定 |
| `tools/build_assets.sh: line 6: <PY>: No such file or directory` | `PY` のパス違い・Python 未導入 | `PY` のパスを確認 |
| `FileNotFoundError: ... 32dot_ver16.3/32dot_tachie.psd` | 32dot の PSD が固定パスに無い | 上の表の置き場所に置く |
| `MOIKY_DIR が未設定。Moiky氏の立ち絵フォルダを指定する` | `MOIKY_DIR` 未設定 | `export MOIKY_DIR=...` |
| `FileNotFoundError: [Errno 2] No such file or directory: '<MOIKY_DIR>'` | `MOIKY_DIR` のパス違い | フォルダのパスを確認 |
| `KeyError: '<フォルダ名>'` | `MOIKY_DIR` 直下にキャラのフォルダが無い・名前違い | `src/shared/chars.json` の `dir` と同じ名前にする |
