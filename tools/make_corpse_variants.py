#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从原版尸体贴图切出"缺胳膊 / 只剩躯干"两个残缺版本。

为什么不另画一套：另画的残骸笔触、明暗、描边粗细都跟原版对不上，
摆在一起一眼就是两种画风。这里直接在原图上把两只手（和头）擦掉，
再沿着新露出来的边界补一圈原图同色的描边（#090909），
于是残缺版和完整版是同一张图、同一套像素，只是"少了块肉"。

用法：
    python tools/make_corpse_variants.py
输出：
    web/assets/sprites/corpse_*_noarms.png   # 两只手没了，头还在
    web/assets/sprites/corpse_*_torso.png    # 手和头都没了，只剩躯干
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SPRITES = os.path.join(ROOT, 'web', 'assets', 'sprites')

BASE_SPRITES = ['corpse_enemy_melee', 'corpse_enemy_gun', 'corpse_enemy_shotgun']

# 四张尸体贴图的轮廓完全一致（32x32，同一个剪影）：
#   躯干横躺 x3..25 / y11..21，头在右端 x19..25 / y13..19，
#   两只手是从头两侧伸出去的小凸起：上面 x16..22 / y9..11，下面 x17..20 / y21..23。
CUT_ARMS = [(16, 9, 7, 3), (16, 21, 5, 3)]        # 上臂+手 / 下臂+手（含拐角那颗描边，否则留一颗悬空像素）
CUT_HEAD = [(19, 12, 7, 9)]                       # 头（含脖子以上）

RIM = (9, 9, 9, 255)       # 原图的描边色，逐像素统计出来的
ALPHA_SOLID = 20           # 原图 alpha 是 0/255 二值（另有 2 个 200），>20 算实心


def cut(src, rects):
    """擦掉 rects 区域，再给新露出的边缘补描边。"""
    im = src.copy()
    px = im.load()
    w, h = im.size
    for (rx, ry, rw, rh) in rects:
        for y in range(ry, ry + rh):
            for x in range(rx, rx + rw):
                if 0 <= x < w and 0 <= y < h:
                    px[x, y] = (0, 0, 0, 0)

    # 补描边：凡是有上下左右邻居是空白的实心像素，刷成描边色。
    # 原图本来就有一圈 1px 描边，所以这里只会改到"刚被切出来"的那些像素。
    edge = []
    for y in range(h):
        for x in range(w):
            if px[x, y][3] <= ALPHA_SOLID:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if not (0 <= nx < w and 0 <= ny < h) or px[nx, ny][3] <= ALPHA_SOLID:
                    edge.append((x, y))
                    break
    for (x, y) in edge:
        px[x, y] = RIM
    return im


def main():
    for name in BASE_SPRITES:
        path = os.path.join(SPRITES, name + '.png')
        src = Image.open(path).convert('RGBA')
        if src.size != (32, 32):
            raise SystemExit('%s 尺寸不是 32x32：%s' % (name, src.size))

        noarms = cut(src, CUT_ARMS)
        noarms.save(os.path.join(SPRITES, name + '_noarms.png'))

        torso = cut(src, CUT_ARMS + CUT_HEAD)
        torso.save(os.path.join(SPRITES, name + '_torso.png'))

        print('%-22s -> _noarms + _torso' % name)


if __name__ == '__main__':
    main()
