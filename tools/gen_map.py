# 和敬塾本館1F図面（左右対称化版）をなぞった簡略間取りを、タイルマップ map.json に書き出す
# 左半分と中央だけ定義し、右半分は鏡写しで作る。部屋は外周＝壁、内側＝床。隣接する部屋は外周を共有し、doors で開ける
import json, os, sys
from collections import deque
from PIL import Image

D = os.path.dirname(os.path.abspath(__file__))
TILE = 16                 # ゲーム内px。図面4px = 1タイル（縮尺1:4）
W, H = 194, 126           # タイル数（図面778x504 / 4）
mx = lambda x: W - 1 - x  # 鏡写し

# id: (x0, y0, x1, y1, 種別)  種別: home=自宅拠点 / loot=資材部屋 / path=廊下 / center=中立
LEFT = {
    'study':    (3, 2, 27, 26, 'home'),    # 御書斎
    'library':  (27, 4, 53, 33, 'home'),   # 図書室（旧 annexN と parlor を統合）
    'bath':     (3, 26, 27, 33, 'loot'),
    'corrN':    (0, 33, 62, 38, 'path'),   # 長い廊下
    'dining':   (62, 30, 84, 67, 'home'),  # 御食堂
    'kitchen':  (28, 38, 56, 52, 'loot'),
    'corrV':    (56, 38, 62, 74, 'path'),
    'svcA':     (22, 52, 40, 69, 'loot'),
    'svcB':     (40, 52, 56, 69, 'loot'),
    'svcC':     (22, 69, 56, 86, 'loot'),
    'corrS':    (56, 74, 84, 79, 'path'),   # アトリウムの左の壁まで伸ばす
}
CENTER = {
    'smoking':  (84, 24, 109, 44, 'center'),  # 御喫煙室
    'hall':     (84, 44, 109, 74, 'center'),  # 大ホール
    'entrance': (84, 74, 109, 91, 'center'),  # 玄関ホール（縮めた。上辺はホールとの境のまま）
    'corrTop':  (53, 18, W - 1 - 53, 24, 'path'),  # 左右の図書室を結ぶ通路（途中で smoking の上辺に出入口）
}
# 部屋の設定名（世界観。このマップは寮の1階）。(左, 右) は左右で違う名前。廊下（corrN・corrV・corrS）は未定
NAMES = {
    'study': ('道場', '茶室'), 'bath': ('道場', '茶室'), 'library': ('弓道場', '窯小屋の近く'), 'kitchen': ('ジム', '音楽室'),
    'svcA': ('会議室', '工作室'), 'svcB': ('PCルーム', 'アトリエ'), 'svcC': '階段ホール', 'dining': ('パーティールーム', 'リビングダイニングキッチン'),
    'smoking': 'ウッドデッキ', 'hall': 'ホール', 'entrance': 'アトリウム', 'corrTop': '犬走り',
}
name = lambda k, i: (lambda n: n[i] if isinstance(n, tuple) else n)(NAMES.get(k))
# 扉: (x0, y0, x1, y1) を床にする
DOORS_LEFT = [
    (27, 18, 27, 22), (4, 26, 26, 26),  # 2つ目: study と bath の間の壁を撤去して1つの空間に
    (20, 33, 24, 33), (47, 33, 51, 33),
    (62, 34, 62, 38), (39, 38, 43, 38), (57, 38, 61, 38), (56, 42, 56, 46),
    (62, 59, 62, 63), (56, 57, 56, 61), (40, 58, 40, 62), (29, 69, 33, 69),
    (46, 69, 50, 69), (56, 70, 56, 74), (57, 74, 61, 74), (84, 75, 84, 78),
    (84, 54, 84, 58), (84, 35, 84, 39),
    (53, 19, 53, 23),  # 図書室 ↔ 上の通路
]
DOORS_CENTER = [(95, 44, 98, 44), (93, 74, 100, 74), (95, 24, 98, 24)]  # 最後: 上の通路 ↔ smoking の上辺

rooms = []
for k, (x0, y0, x1, y1, t) in LEFT.items():
    rooms.append({'id': k + '_L', 'team': 'kiritan', 'type': t, 'rect': [x0, y0, x1, y1], 'name': name(k, 0)})
    rooms.append({'id': k + '_R', 'team': 'zundamon', 'type': t, 'rect': [mx(x1), y0, mx(x0), y1], 'name': name(k, 1)})
for k, (x0, y0, x1, y1, t) in CENTER.items():
    rooms.append({'id': k, 'team': None, 'type': t, 'rect': [x0, y0, x1, y1], 'name': name(k, 0)})
doors = DOORS_CENTER + DOORS_LEFT + [(mx(x1), y0, mx(x0), y1) for x0, y0, x1, y1 in DOORS_LEFT]

VOID, FLOOR, WALL = 0, 1, 2
g = [[VOID] * W for _ in range(H)]
for r in rooms:                       # 外周を壁に
    x0, y0, x1, y1 = r['rect']
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if (x in (x0, x1) or y in (y0, y1)) and g[y][x] == VOID:
                g[y][x] = WALL
for r in rooms:                       # 内側を床に（内側は外周より優先）
    x0, y0, x1, y1 = r['rect']
    for y in range(y0 + 1, y1):
        for x in range(x0 + 1, x1):
            g[y][x] = FLOOR
for x0, y0, x1, y1 in doors:
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            g[y][x] = FLOOR

# 検証: 左右対称 / 床が1つにつながっている / 全部屋の内側に到達できる
assert all(g[y][x] == g[y][mx(x)] for y in range(H) for x in range(W)), 'not symmetric'
floor = [(x, y) for y in range(H) for x in range(W) if g[y][x] == FLOOR]
seen = {floor[0]}; q = deque([floor[0]])
while q:
    x, y = q.popleft()
    for nx, ny in ((x+1, y), (x-1, y), (x, y+1), (x, y-1)):
        if 0 <= nx < W and 0 <= ny < H and g[ny][nx] == FLOOR and (nx, ny) not in seen:
            seen.add((nx, ny)); q.append((nx, ny))
unreach = [r['id'] for r in rooms if ((r['rect'][0] + r['rect'][2]) // 2, (r['rect'][1] + r['rect'][3]) // 2) not in seen]
assert not unreach, f'unreachable: {unreach}'

# 視界だけ通す壁（clear）: glass＝アトリウム（entrance）の南の壁（角を除く）、fence＝自習室・サンルーム（library）の外周のうち建物の外に接する壁と、犬走り（corrTop）の外周の壁と、ウッドデッキ（smoking）の外に面する壁
R = {r['id']: r['rect'] for r in rooms}
at = lambda x, y: g[y][x] if 0 <= x < W and 0 <= y < H else VOID
out4 = lambda x, y: any(at(x + dx, y + dy) == VOID for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
def perim(k):
    x0, y0, x1, y1 = R[k]
    return [[x, y] for y in range(y0, y1 + 1) for x in range(x0, x1 + 1) if (x in (x0, x1) or y in (y0, y1)) and g[y][x] == WALL]
x0, y0, x1, y1 = R['entrance']
glass = [[x, y1] for x in range(x0 + 1, x1) if g[y1][x] == WALL]
fence = [p for k in ('library_L', 'library_R') for p in perim(k) if out4(*p)]
fence += [p for p in perim('corrTop') if p not in fence]
fence += [p for p in perim('smoking') if out4(*p) and p not in fence]  # ウッドデッキ（smoking）の左右の壁のうち建物の外に面する上の端

json.dump({'tileSize': TILE, 'width': W, 'height': H,
           'tiles': [''.join('.#'[c == WALL] if c else ' ' for c in row) for row in g],
           'rooms': rooms, 'clear': {'glass': glass, 'fence': fence}},open(sys.argv[1] if len(sys.argv) > 1 else f'{D}/map.json', 'w'), ensure_ascii=False)

# プレビュー: 図面に重ねる（床=陣営色、壁=黒）。図面が無ければ省略
if not os.path.exists(f'{D}/preview/plan_1f_sym_clean.png'):
    print('ok', W * TILE, 'x', H * TILE, 'px,', len(rooms), 'rooms (preview skipped)'); sys.exit()
plan = Image.open(f'{D}/preview/plan_1f_sym_clean.png').convert('RGBA').resize((W * 4, H * 4))
ov = Image.new('RGBA', (W, H), (0, 0, 0, 0)); px = ov.load()
team = {}
for r in rooms:
    x0, y0, x1, y1 = r['rect']
    col = {'kiritan': (255, 140, 40), 'zundamon': (60, 200, 80), None: (120, 160, 255)}[r['team']]
    a = 150 if r['type'] == 'home' else 70 if r['type'] == 'loot' else 40
    for y in range(y0 + 1, y1):
        for x in range(x0 + 1, x1):
            px[x, y] = col + (a,)
for y in range(H):
    for x in range(W):
        if g[y][x] == WALL: px[x, y] = (0, 0, 0, 255)
        elif g[y][x] == FLOOR and px[x, y][3] == 0: px[x, y] = (255, 255, 255, 200)
plan.alpha_composite(ov.resize((W * 4, H * 4), Image.NEAREST)); plan.save(f'{D}/preview/map_overlay.png')
print('ok', W * TILE, 'x', H * TILE, 'px,', len(rooms), 'rooms,', len(floor), 'floor tiles')
