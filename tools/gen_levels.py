# -*- coding: utf-8 -*-
"""生成 24x16 的剧情关卡地图并校验（连通性 / 敌人站位 / 不贴门）。"""
import sys
from collections import deque

W, H = 24, 16
TILE = 24


def new_map():
    g = [['#'] * W for _ in range(H)]
    for y in range(1, 12):
        for x in range(1, W - 1):
            g[y][x] = '.'
    return g


def hwall(g, y, x0, x1, doors=()):
    for x in range(x0, x1 + 1):
        g[y][x] = 'D' if x in doors else '#'


def vwall(g, x, y0, y1, doors=()):
    for y in range(y0, y1 + 1):
        g[y][x] = 'D' if y in doors else '#'


def street(g, door_x, spawn_x=2):
    for x in range(1, W - 1):
        g[13][x] = 'r'
        g[14][x] = 'r'
    g[12] = ['#'] * W
    g[12][door_x] = 'D'
    g[14][spawn_x] = 'P'


def put(g, cells, ch='o'):
    for (x, y) in cells:
        assert g[y][x] == '.', ('furniture on non-floor', x, y, g[y][x])
        g[y][x] = ch


def build(level):
    g = new_map()
    if level == 0:      # 序章：上排 3 房 + 横廊 + 下排 3 房
        vwall(g, 6, 1, 4)
        vwall(g, 14, 1, 4)
        hwall(g, 5, 1, 22, doors=(3, 10, 18))
        hwall(g, 7, 1, 22, doors=(2, 9, 18))
        vwall(g, 5, 8, 11)
        vwall(g, 13, 8, 11)
        street(g, 11, 2)
    elif level == 1:    # 猎犬：上排 4 小房 + 双行走廊 + 下排 3 房
        vwall(g, 5, 1, 4)
        vwall(g, 10, 1, 4)
        vwall(g, 15, 1, 4)
        hwall(g, 5, 1, 22, doors=(2, 7, 12, 19))
        hwall(g, 8, 1, 22, doors=(3, 11, 19))
        vwall(g, 7, 8, 11)
        vwall(g, 15, 8, 11)
        street(g, 11, 2)
    elif level == 2:    # 破晓：中央竖廊 + 左右各 3 房
        vwall(g, 8, 1, 11, doors=(2, 6, 10))
        vwall(g, 15, 1, 11, doors=(2, 6, 10))
        hwall(g, 4, 1, 7)
        hwall(g, 8, 1, 7)
        hwall(g, 4, 16, 22)
        hwall(g, 8, 16, 22)
        street(g, 11, 2)
    else:               # 终章：中央大厅（4 门）+ 环形外廊
        hwall(g, 3, 5, 18, doors=(8, 15))
        hwall(g, 9, 5, 18, doors=(8, 15))
        vwall(g, 5, 3, 9, doors=(6,))
        vwall(g, 18, 3, 9, doors=(6,))
        street(g, 11, 2)
    return g


FURN = {
    0: [(4, 1), (1, 4), (13, 1), (7, 4), (22, 1), (15, 4), (4, 11), (6, 11), (12, 8), (22, 11), (14, 8)],
    1: [(4, 1), (1, 4), (9, 1), (6, 4), (14, 1), (11, 4), (22, 2), (16, 4), (6, 10), (1, 11), (14, 10), (8, 11), (22, 10), (16, 11)],
    # 第三关每间房的房门开在中间那行（y=2/6/10），木箱一律放在房间另一头（y=1/5/9 的内墙侧），
    # 不能落在门的正对面 —— 木箱是实心格，堵在门口那格这间房就彻底进不去了。
    2: [(7, 1), (1, 3), (7, 5), (1, 7), (7, 9), (1, 11), (16, 1), (22, 3), (16, 5), (22, 7), (16, 9), (22, 11)],
    3: [(6, 4), (17, 4), (6, 8), (17, 8), (10, 5), (13, 5), (2, 2), (21, 2), (2, 10), (21, 10)],
}

BARRELS = {3: [(9, 6), (14, 7)]}

ENEMIES = {
    0: [('melee', 2, 2), ('melee', 4, 3), ('melee', 9, 2), ('melee', 12, 3),
        ('melee', 17, 2), ('melee', 21, 3), ('melee', 2, 9), ('melee', 10, 9)],
    1: [('melee', 2, 2), ('gun', 4, 3), ('melee', 7, 2), ('gun', 9, 3),
        ('gun', 12, 2), ('melee', 14, 3), ('gun', 17, 2), ('gun', 21, 3),
        ('melee', 5, 6), ('gun', 17, 7), ('gun', 2, 10), ('melee', 5, 11),
        ('gun', 9, 10), ('melee', 13, 11)],
    2: [('melee', 2, 2), ('gun', 6, 2), ('gun', 2, 6), ('melee', 6, 6),
        ('gun', 2, 10), ('shotgun', 6, 10), ('gun', 17, 2), ('melee', 21, 2),
        ('shotgun', 17, 6), ('gun', 21, 6), ('gun', 17, 10), ('melee', 21, 10),
        ('gun', 11, 2), ('melee', 12, 5), ('gun', 10, 7), ('gun', 12, 10)],
    3: [('shotgun', 7, 5), ('melee', 11, 4), ('gun', 16, 5), ('gun', 9, 5),
        ('gun', 13, 8), ('melee', 15, 7), ('gun', 7, 7), ('gun', 11, 6),
        ('melee', 3, 1), ('gun', 10, 1), ('shotgun', 20, 1), ('gun', 2, 4),
        ('melee', 3, 6), ('gun', 20, 4), ('gun', 21, 6), ('melee', 4, 10),
        ('gun', 9, 11), ('shotgun', 19, 10)],
}


def solid(ch):
    # 碰撞上和墙一样的东西：墙、木箱、油桶（game.js 里 covers / barrels 都塞进 world.walls）
    return ch in '#oX'


def check(level, g):
    errs = []
    for y, row in enumerate(g):
        assert len(row) == W, ('row len', y, len(row))
    # P
    px = py = None
    for y in range(H):
        for x in range(W):
            if g[y][x] == 'P':
                px, py = x, y
    assert px is not None, 'no P'
    # BFS（木箱/油桶算实心，别再用"能走过去"糊弄过去）
    seen = {(px, py)}
    q = deque([(px, py)])
    while q:
        x, y = q.popleft()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = x + dx, y + dy
            if 0 <= nx < W and 0 <= ny < H and (nx, ny) not in seen:
                if not solid(g[ny][nx]):
                    seen.add((nx, ny))
                    q.append((nx, ny))
    doors = [(x, y) for y in range(H) for x in range(W) if g[y][x] == 'D']
    # 门口不能有木箱/油桶：门只有一格宽，正对门的那格是唯一进出口
    for dx, dy in doors:
        for ax, ay in ((dx - 1, dy), (dx + 1, dy), (dx, dy - 1), (dx, dy + 1)):
            if 0 <= ax < W and 0 <= ay < H and solid(g[ay][ax]) and g[ay][ax] != '#':
                errs.append('furniture %r blocks door at %d,%d (via %d,%d)'
                            % (g[ay][ax], dx, dy, ax, ay))
    for kind, x, y in ENEMIES[level]:
        if g[y][x] != '.':
            errs.append('enemy on %r at %d,%d' % (g[y][x], x, y))
        if (x, y) not in seen:
            errs.append('enemy unreachable at %d,%d' % (x, y))
        dmin = min(((x - dx) ** 2 + (y - dy) ** 2) ** 0.5 for dx, dy in doors)
        if dmin * TILE < 34:
            errs.append('enemy too close to door %d,%d (%.0fpx)' % (x, y, dmin * TILE))
    # 地板连通性：所有 '.' 都可达？
    for y in range(H):
        for x in range(W):
            if g[y][x] == '.' and (x, y) not in seen:
                errs.append('unreachable floor %d,%d' % (x, y))
    return errs, len(seen)


for lv in (range(4) if '--js' not in sys.argv else []):
    g = build(lv)
    put(g, FURN[lv], 'o')
    put(g, BARRELS.get(lv, []), 'X')
    errs, n = check(lv, g)
    print('=== level', lv, 'reachable', n, 'enemies', len(ENEMIES[lv]))
    for e in errs[:12]:
        print('  !!', e)
    if not errs:
        for row in g:
            print("        '" + ''.join(row) + "',")
        print("      enemies: [")
        for kind, x, y in ENEMIES[lv]:
            print("        { kind: '%s', pos: [%d, %d] }," % (kind, x, y))
        print("      ]")

TITLES = ['序章 · 破门', '第二章 · 猎犬', '第三章 · 破晓', '终章 · 炽线']
if '--js' in sys.argv:
    out = []
    for lv in range(4):
        g = build(lv)
        put(g, FURN[lv], 'o')
        put(g, BARRELS.get(lv, []), 'X')
        errs, _ = check(lv, g)
        assert not errs, errs
        out.append("    {\n      title: '%s',\n      rows: [\n" % TITLES[lv])
        for row in g:
            out.append("        '" + ''.join(row) + "',\n")
        out.append("      ],\n      enemies: [\n")
        for kind, x, y in ENEMIES[lv]:
            out.append("        { kind: '%s', pos: [%d, %d] },\n" % (kind, x, y))
        out.append("      ]\n    }%s\n" % (',' if lv < 3 else ''))
    print(''.join(out))
