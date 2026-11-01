# -*- coding: utf-8 -*-
"""生成像素占位贴图（不依赖 Pillow，纯标准库写 PNG）。
用法: python tools/gen_assets.py
所有贴图都是程序画的，方便之后用美术资源整体替换。
"""
import zlib
import struct
import os
import math
import random

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "sprites")


class C:
    def __init__(self, w, h):
        self.w = w
        self.h = h
        self.p = [[(0, 0, 0, 0) for _ in range(w)] for _ in range(h)]

    def set(self, x, y, c):
        if len(c) == 3:
            c = (c[0], c[1], c[2], 255)
        x, y = int(x), int(y)
        if 0 <= x < self.w and 0 <= y < self.h:
            self.p[y][x] = c

    def blend(self, x, y, c):
        if len(c) == 3:
            c = (c[0], c[1], c[2], 255)
        x, y = int(x), int(y)
        if not (0 <= x < self.w and 0 <= y < self.h):
            return
        o = self.p[y][x]
        a = c[3] / 255.0
        self.p[y][x] = (
            int(c[0] * a + o[0] * (1 - a)),
            int(c[1] * a + o[1] * (1 - a)),
            int(c[2] * a + o[2] * (1 - a)),
            max(o[3], c[3]),
        )

    def rect(self, x0, y0, x1, y1, c, blendit=False):
        for y in range(int(y0), int(y1)):
            for x in range(int(x0), int(x1)):
                if blendit:
                    self.blend(x, y, c)
                else:
                    self.set(x, y, c)

    def ell(self, cx, cy, rx, ry, c, blendit=False):
        for y in range(int(cy - ry) - 1, int(cy + ry) + 2):
            for x in range(int(cx - rx) - 1, int(cx + rx) + 2):
                dx = (x + 0.5 - cx) / rx
                dy = (y + 0.5 - cy) / ry
                if dx * dx + dy * dy <= 1.0:
                    if blendit:
                        self.blend(x, y, c)
                    else:
                        self.set(x, y, c)

    def circ(self, cx, cy, r, c, blendit=False):
        self.ell(cx, cy, r, r, c, blendit)

    def save(self, name):
        path = os.path.join(OUT, name) if not name.startswith("..") else os.path.normpath(os.path.join(OUT, name))
        raw = bytearray()
        for row in self.p:
            raw.append(0)
            for px in row:
                raw += bytes(px)
        def chunk(tag, data):
            return (
                struct.pack(">I", len(data))
                + tag
                + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
            )
        png = b"\x89PNG\r\n\x1a\n"
        png += chunk(b"IHDR", struct.pack(">IIBBBBB", self.w, self.h, 8, 6, 0, 0, 0))
        png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        png += chunk(b"IEND", b"")
        with open(path, "wb") as f:
            f.write(png)


# ---------------------------------------------------------------- 笔刷
OUTLINE = (10, 8, 14, 255)


def limb(cv, x0, y0, x1, y1, r0, r1, c):
    """沿线段排一串圆：带锥度的肢体、枪管、棍身都用它画。"""
    d = math.hypot(x1 - x0, y1 - y0)
    n = max(2, int(d * 2.4))
    for i in range(n + 1):
        t = i / n
        cv.circ(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r0 + (r1 - r0) * t, c)


def _hi(c, k=1.32, d=10):
    return (min(255, int(c[0] * k) + d), min(255, int(c[1] * k) + d),
            min(255, int(c[2] * k) + d), 255)


def _lo(c, k=0.62):
    return (max(0, int(c[0] * k)), max(0, int(c[1] * k)), max(0, int(c[2] * k)), 255)


# ---------------------------------------------------------------- 角色
# 俯视视角：X 轴是身体前后，Y 轴是肩宽。
#
# 核心约束（第一版就是栽在这）：**躯干的 Y 半径必须大于 X 半径**。
# 站着的人，从左肩到右肩约 45cm，胸厚只有 25cm —— 从头顶看下去，
# 最宽的方向是「左右」，不是「前后」。一旦把躯干画成沿 X 拉长的条状，
# 大脑立刻读作"趴着的尸体"，因为只有躺下时身长才沿前后轴铺开。
#
# 第二个约束：影子不能比身体大。影子一大，"人浮在地上"的高度感就没了。
# 第三个约束：四肢的根部必须插进躯干内部再被躯干盖住。
# 从躯干外沿才开始画手臂，中间隔着一圈描边，看着就是"圆盘 + 四个零件"，
# 也就是上一版的螃蟹。先画四肢、后画躯干，自动融为一体。
# 第四个约束：躯干内部不能是同心椭圆。
# OUTLINE → 暗底 → 亮面 三层同心椭圆叠出来就是一个"环"，头压上去就成了甜甜圈，
# 这是这个尺寸下最容易犯的错。明暗必须做成不对称的大块（偏左上受光、右下压暗）。
#
# 第五个约束：头必须有自己的投影。俯视时"头顶是离镜头最近的面"这件事，
# 全靠把头往右下偏移的暗影投在胸口上来表达；没有这层影子，头就是贴纸。
def outlined(paint, w=32, h=32):
    """先画纯色块，最后统一在整体轮廓外描 1px 黑边。

    逐块描边（每条四肢、每个椭圆自己一圈黑线）会让身体内部出现分割线，
    整个人看起来像一堆积木拼的零件 —— 这是"螃蟹感"的真正来源。
    统一描边之后，腿和躯干会自动融成一整块剪影。
    """
    fill = C(w, h)
    paint(fill)
    out = C(w, h)
    for y in range(h):
        for x in range(w):
            if fill.p[y][x][3] > 0:
                continue
            hit = False
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    nx, ny = x + dx, y + dy
                    if 0 <= nx < w and 0 <= ny < h and fill.p[ny][nx][3] > 0:
                        hit = True
                        break
                if hit:
                    break
            if hit:
                out.set(x, y, OUTLINE)
    for y in range(h):
        for x in range(w):
            c = fill.p[y][x]
            if c[3] > 0:
                out.set(x, y, c)
    return out


def draw_corpse(coat, coat_dark, hair, skin, pants=None):
    """32x32 面朝下摊开的尸体（俯视）。

    为什么回到"摊开"而不是"跪着蜷一团"：
    正上方俯视时，跪姿的身体被透视压短，32px 下只剩一团色块，读不出人形；
    而趴着的身体是沿死亡方向（+X）铺开的长条 —— 头在前、肩宽、腰收、腿往后拖，
    这个"长条 + 肩宽 + 头在前"的剪影才是俯视下唯一稳定的人形读法。

    关键手法：整块剪影只描一圈外轮廓（outlined）。
    旧版给每条肢体单独描边，结果躯干内部出现分割线，整个人像一堆积木拼的螃蟹。
    """
    coat = _lo(coat, 0.60)
    coat_dark = _lo(coat_dark, 0.66)
    hair = _lo(hair, 0.70)
    skin = _lo(skin, 0.82)
    if pants is None:
        pants = _lo(coat_dark, 0.76)
    cy = 16.0

    def paint(f):
        # ---- 腿：两截短桩，并拢往身后拖。腿是"收"的不是"张"的 ——
        # 扇形张开的腿会把剪影撑成海星，这是上一版最大的问题。
        limb(f, 9.6, cy - 1.6, 5.2, cy - 2.6, 2.3, 1.6, pants)
        f.circ(4.8, cy - 2.9, 1.2, _lo(pants, 0.9))
        limb(f, 9.6, cy + 1.8, 4.8, cy + 3.0, 2.3, 1.6, pants)
        f.circ(4.4, cy + 3.3, 1.2, _lo(pants, 0.9))

        # ---- 躯干：拉长的椭圆是主体块（长轴沿 X，才读作"躺下"）
        f.ell(14.8, cy + 0.2, 6.3, 4.4, coat)
        f.ell(15.9, cy - 1.2, 4.7, 2.6, _hi(coat, 1.15, 6))     # 背脊受光
        f.ell(12.6, cy + 2.0, 3.7, 2.0, _lo(coat, 0.55))        # 腰下压暗

        # ---- 手臂：一只前伸到头侧，一只摊在地上（不对称，避免左右镜像的假人感）
        limb(f, 17.6, cy - 2.5, 20.6, cy - 4.3, 2.0, 1.3, coat_dark)
        f.circ(21.0, cy - 4.6, 1.5, skin)
        limb(f, 16.4, cy + 3.1, 18.6, cy + 5.5, 1.9, 1.2, coat_dark)
        f.circ(19.0, cy + 5.9, 1.4, skin)

        # ---- 头：最前，脸朝下压地。头发压暗，只露一小片侧脸，避免"亮球"感
        f.circ(21.4, cy, 3.3, _lo(hair, 0.9))
        f.ell(20.5, cy - 1.2, 1.7, 1.2, _hi(hair, 1.15, 6))
        f.ell(23.0, cy + 1.3, 1.3, 1.0, skin)
        # 头投在胸口的暗影（俯视"头最近"全靠这层）
        f.ell(19.1, cy + 0.5, 1.7, 2.3, (0, 0, 0, 44), True)

        # ---- 血迹：少量、集中在躯干下侧与颈下
        random.seed(23)
        for _ in range(5):
            f.ell(11.0 + random.random() * 9.5, cy + random.uniform(-2.6, 3.2),
                  random.uniform(1.0, 2.2), random.uniform(0.8, 1.5), (72, 8, 14, 200), True)

    return outlined(paint, 32, 32)


def draw_ring():
    """命中冲击环：中心亮、边缘淡的一圈光。
    打击感最便宜的单一元素 —— 一个瞬间扩散并消失的白环，比加更多血更有"打到"的感觉。"""
    cv = C(32, 32)
    cx = cy = 16.0
    for y in range(32):
        for x in range(32):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            if 10.6 <= d <= 14.8:
                t = 1.0 - abs(d - 12.7) / 2.1
                a = int(max(0.0, min(255.0, 30.0 + 235.0 * t)))
                cv.set(x, y, (255, 248, 238, a))
    return cv


def draw_shadow():
    """脚下的投影：跟身体轮廓同形、只大一圈。
    画得比人还大一圈，人会立刻读成"躺在地上"——影子大小就是高度暗示。"""
    cv = C(32, 32)
    cv.ell(16.8, 18.4, 8.6, 8.8, (0, 0, 0, 70))
    cv.ell(16.6, 18.2, 6.6, 6.8, (0, 0, 0, 52))
    return cv


# ---------------------------------------------------------------- 场景
def draw_floor(seed=1, tint=(56, 44, 48)):
    random.seed(seed)
    cv = C(24, 24)
    base = tint
    cv.rect(0, 0, 24, 24, (base[0], base[1], base[2], 255))
    # 竖向木条
    for x in range(0, 24, 8):
        shade = 8 if (x // 8) % 2 == 0 else -5
        cv.rect(x, 0, x + 7, 24, (base[0] + shade, base[1] + shade, base[2] + shade, 255))
        cv.rect(x + 7, 0, x + 8, 24, (base[0] - 16, base[1] - 16, base[2] - 16, 255))
        # 木纹
        for _ in range(4):
            y = random.randint(0, 20)
            cv.rect(x + 1, y, x + 6, min(24, y + random.randint(1, 4)),
                    (base[0] + shade - 9, base[1] + shade - 9, base[2] + shade - 9, 255))
    # 噪点
    for _ in range(30):
        x, y = random.randint(0, 23), random.randint(0, 23)
        d = random.choice([-12, -7, 7, 12])
        cv.blend(x, y, (base[0] + d, base[1] + d, base[2] + d, 110))
    return cv


def draw_wall():
    cv = C(24, 24)
    brick = (86, 78, 96, 255)
    mortar = (40, 36, 46, 255)
    cv.rect(0, 0, 24, 24, mortar)
    random.seed(7)
    for row, y in enumerate(range(0, 24, 6)):
        offset = 0 if row % 2 == 0 else 6
        for x in range(-12, 24, 12):
            x0 = x + offset
            cv.rect(x0 + 1, y + 1, x0 + 11, y + 5, brick)
            cv.rect(x0 + 1, y + 1, x0 + 11, y + 2, (110, 101, 122, 255))
            cv.rect(x0 + 1, y + 4, x0 + 11, y + 5, (64, 58, 74, 255))
    for _ in range(18):
        x, y = random.randint(0, 23), random.randint(0, 23)
        cv.blend(x, y, (30, 26, 36, 80))
    return cv


def draw_door():
    cv = C(24, 24)
    cv.rect(0, 0, 24, 24, (0, 0, 0, 0))
    cv.rect(1, 1, 23, 23, (28, 20, 18, 255))
    cv.rect(2, 2, 22, 22, (104, 66, 42, 255))
    cv.rect(3, 3, 21, 21, (124, 80, 50, 255))
    cv.rect(5, 5, 19, 19, (110, 70, 44, 255))
    cv.rect(6, 6, 18, 18, (130, 84, 52, 255))
    cv.circ(18, 12, 1.6, (222, 190, 90, 255))
    return cv


def draw_cover():
    """俯视木箱/工作台：掩体用。暖木色 + 铁角，和冷色墙砖一眼能分开。"""
    cv = C(24, 24)
    random.seed(31)
    edge = (26, 19, 16, 255)
    wood = (98, 68, 43, 255)
    hi = (130, 93, 60, 255)
    lo = (70, 46, 29, 255)
    cv.rect(0, 0, 24, 24, (0, 0, 0, 0))
    cv.rect(1, 1, 23, 23, edge)          # 外框
    cv.rect(2, 2, 22, 22, wood)
    # 四条横向木板
    for y in (3, 8, 13, 18):
        cv.rect(2, y, 22, y + 4, wood)
        cv.rect(2, y, 22, y + 1, hi)
        cv.rect(2, y + 3, 22, y + 4, lo)
    # 对角撑条
    for i in range(3, 21):
        cv.blend(i, i, (68, 44, 28, 210))
        cv.blend(i, 23 - i, (68, 44, 28, 210))
    # 四角包铁
    for (x, y) in ((1, 1), (20, 1), (1, 20), (20, 20)):
        cv.rect(x, y, x + 3, y + 3, (74, 70, 80, 255))
        cv.rect(x, y, x + 3, y + 1, (104, 100, 112, 255))
    return cv


# ---------------------------------------------------------------- 血迹
BLOOD_DEEP = (74, 8, 16)     # 积得最厚的地方，最暗
BLOOD_DARK = (108, 12, 22)   # 血泊主体
BLOOD_CORE = (146, 18, 32)   # 溅点和薄的地方


def draw_blood(seed, size=48):
    """地面血泊：先铺一滩浓稠的池子，再在边缘撒细碎溅点。
    溅点必须"近、小、密"，撒得太远太大就成了番茄酱爆炸。"""
    random.seed(seed)
    cv = C(size, size)
    cx = cy = size / 2.0
    # 1) 主池：一圈互相重叠的椭圆，形状才不规则
    for _ in range(10):
        a = random.random() * math.tau
        d = random.uniform(0, size * 0.10)
        cv.ell(cx + math.cos(a) * d, cy + math.sin(a) * d,
               random.uniform(size * 0.19, size * 0.28),
               random.uniform(size * 0.16, size * 0.24),
               (BLOOD_DARK[0], BLOOD_DARK[1], BLOOD_DARK[2], 243))
    # 2) 池子中央积得更厚 —— 越厚越暗，不是越亮
    cv.ell(cx + random.uniform(-2, 2), cy + random.uniform(-2, 2),
           size * 0.15, size * 0.12,
           (BLOOD_DEEP[0], BLOOD_DEEP[1], BLOOD_DEEP[2], 250))
    # 3) 外围一层很淡的薄膜，边缘才不会像贴纸
    for _ in range(4):
        a = random.random() * math.tau
        d = random.uniform(size * 0.10, size * 0.16)
        cv.ell(cx + math.cos(a) * d, cy + math.sin(a) * d,
               random.uniform(size * 0.24, size * 0.32),
               random.uniform(size * 0.20, size * 0.28),
               (BLOOD_DARK[0], BLOOD_DARK[1], BLOOD_DARK[2], 70), True)
    # 3) 边缘：细碎的溅点，越远越小越淡
    for _ in range(34):
        a = random.random() * math.tau
        d = random.uniform(size * 0.20, size * 0.36)
        r = random.uniform(0.5, 1.9) * (1.0 - (d / (size * 0.4)) * 0.45)
        k = 1.0 - d / (size * 0.42)
        col = BLOOD_CORE if random.random() < 0.7 else BLOOD_DARK
        # blendit=True：半透明必须"混"进底图，直接 set 会把不透明的血泊
        # 挖成一堆半透明像素，导出来就是粉色的
        cv.circ(cx + math.cos(a) * d, cy + math.sin(a) * d, r,
                (col[0], col[1], col[2], int(100 + 105 * k)), True)
    # 4) 几处凝块（不是反光点，反光点会变成噪点）
    for _ in range(5):
        a = random.random() * math.tau
        d = random.uniform(0, size * 0.16)
        cv.circ(cx + math.cos(a) * d, cy + math.sin(a) * d, random.uniform(1.2, 2.4),
                (BLOOD_DEEP[0], BLOOD_DEEP[1], BLOOD_DEEP[2], 215), True)
    return cv


def draw_blood_streak(seed, size=48):
    """朝一个方向甩出去的血痕，用于枪击/近战击杀。"""
    random.seed(seed)
    cv = C(size, size)
    cx = cy = size / 2.0
    # 主干：一条逐渐变细的尾巴
    for i in range(18):
        t = i / 17.0
        cv.circ(cx + t * size * 0.36, cy,
                (1.0 - t) * size * 0.075 + 0.4,
                (BLOOD_CORE[0], BLOOD_CORE[1], BLOOD_CORE[2], 235 - int(45 * t)), True)
    # 旁边的碎点
    for _ in range(14):
        t = random.random()
        cv.circ(cx + t * size * 0.34,
                cy + random.uniform(-1, 1) * (1.0 - t) * size * 0.13,
                random.uniform(0.5, 1.6) * (1.0 - t * 0.5),
                (BLOOD_DARK[0], BLOOD_DARK[1], BLOOD_DARK[2], 190), True)
    return cv


# ---------------------------------------------------------------- 武器图标
# 统一朝右（+X），描边 + 受光面，才不至于糊成一根黑棍。
def draw_pistol():
    cv = C(18, 18)
    steel = (98, 101, 114, 255)
    hi = (154, 158, 174, 255)
    dark = (44, 46, 56, 255)
    wood = (104, 66, 38, 255)
    # 握把（先画，后面被套筒压住）
    limb(cv, 6.4, 10.6, 3.8, 16.2, 2.3, 2.0, OUTLINE)
    limb(cv, 6.4, 10.6, 4.0, 15.9, 1.7, 1.4, wood)
    # 套筒
    cv.rect(3, 5, 17, 11, OUTLINE)
    cv.rect(4, 6, 17, 10, steel)
    cv.rect(4, 6, 17, 7, hi)
    cv.rect(4, 9, 16, 10, dark)
    cv.rect(16, 7, 17, 9, (22, 22, 28, 255))       # 枪口
    for x in (5, 7, 9):                            # 防滑纹
        cv.set(x, 8, dark)
    # 扳机护圈：贴着套筒下沿，做成一个细环
    cv.rect(7, 10, 12, 11, OUTLINE)
    cv.rect(7, 13, 12, 14, OUTLINE)
    cv.rect(7, 11, 8, 13, OUTLINE)
    cv.rect(11, 11, 12, 13, OUTLINE)
    return cv


def draw_shotgun():
    """侧视泵动霰弹枪（雷明顿 870 / 温彻斯特 M1897 那种）。

    识别关键是三层平行关系，少一层就会退化成别的东西：
      上   长枪管（全枪最长的一段，细）
      中   枪管正下方一根更细的管状弹仓
      下   木护木（泵柄）包住弹仓中段，带横向环纹
    再往后接一个矮机匣 + 带"腰"的木质枪托。

    画布做成 22x18（其它枪是 18x18）：霰弹枪本来就比手枪长一截，
    枪管要占到全枪的一半以上才有"长管喷子"的味道，18 宽塞不下。"""
    steel = (116, 120, 134, 255)
    steel_hi = (172, 176, 192, 255)
    steel_lo = (60, 62, 74, 255)
    wood = (136, 88, 48, 255)
    wood_hi = (182, 126, 74, 255)
    wood_lo = (86, 52, 28, 255)
    wood_dark = (66, 38, 20, 255)

    def paint(f):
        # 枪托：上沿齐平接到机匣，下沿往握把处收 1px → 腰；托底压一条暗线
        f.rect(1, 7, 4, 12, wood)
        f.rect(1, 7, 4, 8, wood_hi)
        f.rect(1, 11, 4, 12, wood_lo)
        f.rect(4, 7, 7, 11, wood)
        f.rect(4, 7, 7, 8, wood_hi)
        f.rect(4, 10, 7, 11, wood_lo)

        # 机匣：矮方块，顶面平（和枪管上沿接齐），抛壳口开在侧面
        f.rect(7, 7, 10, 11, steel_lo)
        f.rect(7, 7, 10, 8, steel)

        # 枪管：2px 细长管（上沿高光），右端一列暗色当枪口
        f.rect(10, 7, 21, 9, steel)
        f.rect(10, 7, 21, 8, steel_hi)
        f.rect(20, 7, 21, 9, (24, 24, 30, 255))

        # 管状弹仓：贴着枪管下沿，比枪管细（只有 1px）
        f.rect(10, 9, 20, 10, steel_lo)

        # 护木：木色，比枪管粗一圈、包住弹仓中段；下沿压暗 + 三道环纹
        f.rect(11, 9, 17, 11, wood)
        f.rect(11, 9, 17, 10, wood_hi)
        f.rect(11, 10, 17, 11, wood_lo)
        f.rect(12, 10, 13, 11, wood_dark)
        f.rect(14, 10, 15, 11, wood_dark)
        f.rect(16, 10, 17, 11, wood_dark)

    return outlined(paint, 22, 18)


def draw_smg():
    """侧视冲锋枪：紧凑枪身 + 长弹匣下挂 + 枪托。弹匣下挂是冲锋枪的标志。"""
    cv = C(18, 18)
    steel = (104, 108, 122, 255)
    hi = (158, 162, 178, 255)
    dark = (42, 44, 54, 255)
    poly = (58, 60, 70, 255)
    # 枪托（折叠式，短）
    cv.rect(0, 7, 4, 12, OUTLINE)
    cv.rect(0, 8, 4, 11, poly)
    # 机匣
    cv.rect(3, 6, 12, 13, OUTLINE)
    cv.rect(3, 7, 12, 12, steel)
    cv.rect(3, 7, 12, 9, hi)
    cv.rect(3, 11, 12, 12, dark)
    # 枪管（短，冲锋枪射程近）
    cv.rect(12, 7, 18, 11, OUTLINE)
    cv.rect(12, 8, 18, 10, steel)
    cv.rect(12, 8, 18, 9, hi)
    cv.rect(17, 8, 18, 10, (22, 22, 28, 255))
    # 长弹匣（下挂，标志性的长条）
    cv.rect(5, 12, 8, 17, OUTLINE)
    cv.rect(5, 12, 8, 16, poly)
    cv.rect(5, 12, 8, 13, (96, 98, 112, 255))
    # 握把
    cv.rect(8, 11, 11, 14, OUTLINE)
    cv.rect(8, 11, 11, 13, poly)
    return cv


def draw_bat():
    """侧视：细握把 → 粗棒身。锥度必须明显，否则会被看成一条鱼。"""
    cv = C(18, 18)
    wood = (178, 126, 70, 255)
    hi = (214, 160, 100, 255)
    dark = (122, 82, 44, 255)
    wrap = (96, 66, 40, 255)
    # 轮廓（细头）→ 木身 → 上缘高光 / 下缘暗部
    limb(cv, 1.2, 10.0, 16.2, 9.0, 1.0, 3.5, OUTLINE)
    limb(cv, 1.2, 10.0, 16.0, 9.0, 0.5, 2.9, wood)
    limb(cv, 2.2, 9.0, 15.8, 8.0, 0.4, 1.5, hi)
    limb(cv, 2.2, 11.0, 15.8, 10.1, 0.4, 1.2, dark)
    # 握把缠带（比棒身暗一点点，别用接近描边的颜色，否则会看成断开的黑块）
    limb(cv, 2.4, 10.0, 5.4, 9.7, 1.1, 1.2, wrap)
    # 尾端圆头
    cv.circ(1.2, 10.0, 1.6, OUTLINE)
    cv.circ(1.2, 10.0, 1.0, wrap)
    return cv


def draw_knife():
    """侧视：刀身 → 护手 → 刀柄（按遮挡顺序画，护手才不会被刀身盖掉）。"""
    cv = C(18, 18)
    steel = (198, 202, 212, 255)
    hi = (244, 248, 254, 255)
    handle = (58, 42, 36, 255)
    # 刀身
    limb(cv, 7.5, 9.4, 16.2, 9.4, 2.0, 0.9, OUTLINE)
    limb(cv, 7.5, 9.4, 15.9, 9.4, 1.5, 0.7, steel)
    limb(cv, 7.5, 8.6, 14.6, 8.9, 0.6, 0.5, hi)
    # 护手
    cv.rect(6, 6, 8, 14, OUTLINE)
    cv.rect(6, 7, 8, 13, (92, 94, 104, 255))
    cv.rect(6, 7, 8, 8, (140, 142, 154, 255))
    # 刀柄（盖住护手左侧）
    cv.rect(1, 8, 7, 12, OUTLINE)
    cv.rect(1, 9, 6, 11, handle)
    for rx in (3, 5):                      # 铆钉，用暗色，太亮会被当成眼睛
        cv.set(rx, 9, (88, 70, 56, 255))
    return cv


# 四套配色：玩家（红夹克 + 白面具）、近战（紫卫衣）、枪手（蓝西装）、霰弹（土黄工装）
# 头顶那一片必须是画面里最亮的东西。俯视时头顶是唯一受光的面，
# 头不够亮，整个人就只剩一团衣服，读不出形状也看不出朝向。
PALETTES = {
    "player": ((196, 62, 56), (232, 96, 84), (140, 36, 36), (234, 228, 216), (226, 178, 142), None, "plain"),
    "enemy_melee": ((124, 96, 168), (156, 124, 200), (88, 64, 124), (176, 154, 202), (206, 166, 132), None, "hood"),
    "enemy_gun": ((82, 112, 150), (110, 144, 186), (56, 78, 108), (172, 178, 192), (214, 172, 138), (150, 40, 44), "suit"),
    "enemy_shotgun": ((188, 156, 68), (216, 186, 96), (136, 108, 40), (198, 160, 106), (224, 180, 144), None, "cap"),
}


# ---------------------------------------------------------------- 预览拼图
def make_preview():
    """把全部贴图放大拼成一张预览图，方便肉眼检查。"""
    imgs = {
        "shadow": draw_shadow(),
        "wall": draw_wall(), "floor": draw_floor(1), "floor2": draw_floor(2, (40, 32, 44)),
        "door": draw_door(),
        "pistol": draw_pistol(), "shotW": draw_shotgun(),
        "bat": draw_bat(), "knife": draw_knife(),
        "blood": draw_blood(5), "streak": draw_blood_streak(9),
        "cp": draw_corpse(*(PALETTES["player"][0], PALETTES["player"][2],
                            PALETTES["player"][3], PALETTES["player"][4])),
    }
    keys = list(imgs.keys())
    S, pad = 7, 12
    maxh = max(imgs[k].h for k in keys)
    W = sum(imgs[k].w * S + pad for k in keys) + pad
    H = maxh * S + pad * 2
    out = C(W, H)
    out.rect(0, 0, W, H, (34, 29, 38, 255))
    x = pad
    for k in keys:
        im = imgs[k]
        oy = pad + (maxh - im.h) * S // 2
        for y in range(im.h):
            for xx in range(im.w):
                c = im.p[y][xx]
                if c[3] > 0:
                    # 按透明度合成：血迹是半透明的，直接覆写会显示成错的颜色
                    for dy in range(S):
                        for dx in range(S):
                            out.blend(x + xx * S + dx, oy + y * S + dy, c)
        x += im.w * S + pad
    out.save("../../docs/preview.png")


def main():
    os.makedirs(OUT, exist_ok=True)
    draw_shadow().save("shadow.png")
    draw_ring().save("ring.png")

    # 活人不再用贴图：造型是「一个头 + 两只圆手」，在 actor.gd / game.js 里
    # 按朝向实时画，手和眼睛才能连续跟着鼠标走。这里只生成尸体。
    for name, pal in PALETTES.items():
        draw_corpse(pal[0], pal[2], pal[3], pal[4]).save("corpse_%s.png" % name)

    draw_floor(1).save("floor.png")
    draw_floor(2, (38, 30, 42)).save("floor2.png")
    draw_wall().save("wall.png")
    draw_door().save("door.png")
    draw_cover().save("cover.png")

    for i in range(6):
        draw_blood(i * 17 + 3).save("blood_%d.png" % (i + 1))
    for i in range(3):
        draw_blood_streak(i * 23 + 5).save("blood_streak_%d.png" % (i + 1))

    draw_pistol().save("w_pistol.png")
    draw_shotgun().save("w_shotgun.png")
    draw_smg().save("w_smg.png")
    draw_bat().save("w_bat.png")
    draw_knife().save("w_knife.png")

    make_preview()

    print("assets written to", OUT)
    for f in sorted(os.listdir(OUT)):
        print("  ", f)


if __name__ == "__main__":
    main()
