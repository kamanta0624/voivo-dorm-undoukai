# Moiky氏の立ち絵を src/shared/chars.json の対応表どおりにコピーする。出力: <OUT>/<key>/{select,ko,koed}.png（git 管理外）
import json, os, shutil, sys, unicodedata as u

SRC = os.path.expanduser('<MOIKY_DIR>')
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
    print(key, c['select'], c['ko'], c['koed'] or '-')
