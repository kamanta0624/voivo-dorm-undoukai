# Moiky氏の立ち絵を src/shared/chars.json の対応表どおりにコピーする。出力: <OUT>/<key>/{select,ko,koed}.png と反応の差分 r<添字>.png（react.diffs の順。git 管理外）
import json, os, shutil, sys, unicodedata as u

if not os.environ.get('MOIKY_DIR'): sys.exit('MOIKY_DIR が未設定。Moiky氏の立ち絵フォルダを指定する: export MOIKY_DIR=<立ち絵フォルダ>')
SRC = os.path.expanduser(os.environ['MOIKY_DIR'])
D = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[1]
N = lambda s: u.normalize('NFC', s)

chars = {k: v for k, v in json.load(open(f'{D}/../src/shared/chars.json')).items() if k != '_'}
dirs = {N(d): d for d in os.listdir(SRC)}
for key, c in chars.items():
    d = os.path.join(SRC, dirs[N(c['dir'])])
    files = {N(f): f for f in os.listdir(d)}
    os.makedirs(f'{OUT}/{key}', exist_ok=True)
    for slot in ('select', 'ko', 'koed'):
        if c[slot]: shutil.copyfile(os.path.join(d, files[N(c[slot]) + '.png']), f'{OUT}/{key}/{slot}.png')
    for i, name in enumerate(c.get('react', {}).get('diffs', [])): shutil.copyfile(os.path.join(d, files[N(name) + '.png']), f'{OUT}/{key}/r{i}.png') # 余白の立ち絵の反応の差分（react1。加工しない）
    print(key, c['select'], c['ko'], c['koed'] or '-')
