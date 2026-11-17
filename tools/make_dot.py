# 32dot立ち絵PSDからボイボ寮4vs4用のドットを書き出す。PSDは読むだけ。画素は加工しない（重ねて等倍縮小するだけ）
# 手本: ~/Projects/tsuina_onitaiji/game/assets/ui/_gen/make_dot.py
# 出力: out/<key>/{idle,walk1,walk2,half,close,banzai}.png（32x42）。out/ は素材の二次配布防止のため git 管理外にする
import os, sys, unicodedata as u
from psd_tools import PSDImage
from PIL import Image

PSD = os.path.expanduser('~/Projects/tsuina_onitaiji/assets_src/images/32dot_ver16.3/32dot_tachie.psd')
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), 'out')
CHARS = {  # key: (PSDの名前の頭, 脚（None は足なし）, 固有差分)
    'hanamaru': ('満別花丸', 'shoes01', None),
    'whitecul': ('WhiteCUL', 'shoes01', None),
    'sayo': ('小夜', 'shoes01', None),
    'metan': ('四国めたん', 'shoes01', None),
    'mochiko': ('もち子', 'shoes01', None),
    'aru': ('猫使アル', 'shoes01', '固有差分(猫使アル)'),
    'bii': ('猫使ビィ', 'shoes01', '固有差分(猫使ビィ)'),
    'ierutan': ('あいえるたん', 'shoes01', None),
    'zunko': ('東北ずん子', 'shoes01', None),
    'kiritan': ('東北きりたん', 'shoes01', None),
    'himari': ('冥鳴ひまり', 'shoes01', None),
    'itako': ('東北イタコ', 'shoes01', None),
    'yurei': ('ユーレイちゃん', None, None),  # 足なし（脚は空レイヤー *dummy）
    'ankomon': ('あんこもん', 'shoes01', None),
    'zundamon': ('ずんだもん', 'shoes01', None),
    'kobako': ('ブイブイ・コバコ', 'shoes01', None),  # ブイブイ・コバコ（選べるキャラではない）
    'kurono': ('玄野武宏(新規デザイン', 'pants02', None),  # アシスト（選べるキャラではない）
    'shirakami': ('白上虎太郎(新規デザイン', 'pants02', None),
    'aoyama': ('青山龍星(新規デザイン', 'pants02', None),
}
# 腰（スカート）: 服の色に合うほう。01=青、02=灰。腰がないと正座に見える
WAIST = {'hanamaru': '02', 'whitecul': '01', 'sayo': '02', 'metan': '02', 'mochiko': '02', 'aru': '02', 'bii': '02',
         'ierutan': '02', 'zunko': '02', 'kiritan': '01', 'himari': '02', 'itako': '02', 'yurei': '01', 'ankomon': '02', 'zundamon': '02', 'kobako': '02',
         'kurono': None, 'shirakami': None, 'aoyama': None}  # None: 腰なし（ズボン）
# コマ: (脚, 目, 左腕, 右腕)。腕は *armL_han<番号> / *armR_han<番号>、'dummy' は空レイヤー（描かない）
# 歩きは walk1 ⇔ walk2 の交互（PSDのままの向きで右から左へ歩く。左から右へは左右反転で表示）。banzai は万歳
# 技の見た目用の追加のコマ: key → {コマ: 目レイヤー}。目レイヤーだけを描く（client/skills の frames）
EYES_ONLY = {'himari': {'eyes': '*eye_R04'}}
FRAMES = {'idle': ('A', None, '01', '01'), 'walk1': ('C', None, '02', '03'), 'walk2': ('B', None, '05', 'dummy'),
          'half': ('A', 'hanme01', '01', '01'), 'close': ('A', 'toji01', '01', '01'), 'banzai': ('A', None, '04', '04')}

N = lambda s: u.normalize('NFC', s)
p = PSDImage.open(PSD); G = {g.name: g for g in p}
def L(gn, ln): return next(c for c in G[gn] if N(c.name) == ln)
def body(head): return next(c for c in G['キャラクター'].descendants() if not c.is_group() and N(c.name).startswith(head))
def put(c, l):
    im = l.topil()
    if im is not None: c.alpha_composite(im.convert('RGBA'), (l.left, l.top))  # 空レイヤー（dummy）は描かない
def arm(g, side, n): return L(g, '*dummy' if n == 'dummy' else f'*arm{side}_han{n}')

for key, (head, legs, own) in CHARS.items():
    ch = body(head); os.makedirs(f'{OUT}/{key}', exist_ok=True)
    for name, (leg, eye, al, ar) in FRAMES.items():
        c = Image.new('RGBA', (512, 672), (0, 0, 0, 0))
        put(c, L('脚', f'*leg_{legs}{leg}' if legs else '*dummy')); put(c, L('腰', f'*waist_stand{WAIST[key]}' if WAIST[key] else '*dummy')); put(c, ch)  # 重ね順: 脚 → 腰 → 本体 → 目 → 固有差分 → 左腕 → 右腕
        if eye: put(c, L('目', f'*eye_{eye}'))
        if own: put(c, L('固有差分', own))
        put(c, arm('左腕', 'L', al)); put(c, arm('右腕', 'R', ar))
        c.resize((32, 42), Image.NEAREST).save(f'{OUT}/{key}/{name}.png')
    for name, eye in EYES_ONLY.get(key, {}).items():
        c = Image.new('RGBA', (512, 672), (0, 0, 0, 0))
        put(c, L('目', eye))
        c.resize((32, 42), Image.NEAREST).save(f'{OUT}/{key}/{name}.png')
    print(key, legs, own or '-')
