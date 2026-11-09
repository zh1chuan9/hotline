# -*- coding: utf-8 -*-
"""合成整套贴近现实的音效，输出到 tools/sfx_src/ 下的 wav。

机器上没有 numpy/ffmpeg/scipy，全用纯 Python + wave 模块算。分层合成的思路参考了
真实武器音效的做法（见 synth_pistol.py 顶部注释 & 网上音效设计资料）：
每一声都拆成"瞬态起手 + 主体 + 尾巴"三层，各自占一段频段，分开就不会糊。

手枪单独在 synth_pistol.py 里（已改成清脆版），本脚本负责其余全部：
  smg / shotgun  冲锋枪 / 霰弹
  headpop      脑浆炸开（爆头那一下：湿黏的低频"噗" + 脆壳"啪"）
  blood_land   血液飙出落地（一串细密的湿"滴答"）
  shell_drop   弹壳落地（黄铜小壳在地板上弹跳的"叮叮"）
  shell_eject  抛壳（枪机里弹出来的清脆金属"咔"）
  rack         上膛（拉套筒/泵动，金属滑轨"嚓咔"）
  body_drop    肢体落地（重物砸地 + 布料闷响）
  knife_hit    刀具砍中血肉（利刃入肉的"刷" + 湿闷一声）
  melee_swing  挥刀/挥棍破空声
  flesh_hit    打中躯干：低沉湿黏的闷"噗"
  head_hit     打中头部：又脆又硬的"咔"
  door_open    开门：铰链吱呀 + 门扇到位的轻"咔"（敌人推门 / 玩家开门的常规开门声）
  door_slam    撞门：身体撞上木板 → 铰链扯脱 → 整扇门拍地的沉"轰"
  door_shatter 碎门：木板纤维爆裂 + 木屑先后弹开落地

所有音效先在这里生成 wav，再跑 tools/make_sfx.py 内嵌进 web/js/sfx_samples.js。

注意：只重做某几个音效时用 `python tools/synth_all.py --only=flesh_hit,head_hit`。
全量重跑会让主 rng 的消耗顺序变化，导致后面所有音效的噪声都变（听感会飘）。
新增挂在末尾的 flesh_hit/head_hit 用各自独立的固定 rng，不消耗主链，所以即使
全量重跑，前面 10 个音效的输出也逐字节不变。
"""
import math
import os
import random
import struct
import sys
import wave

SR = 44100
HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, 'sfx_src')


# ---------------------------------------------------------------- 基础工具（同 synth_pistol.py）
def biquad_lp(fc, q):
    w0 = 2 * math.pi * min(fc, SR * 0.45) / SR
    cw, sw = math.cos(w0), math.sin(w0)
    alpha = sw / (2 * q)
    a0 = 1 + alpha
    return ((1 - cw) / 2 / a0, (1 - cw) / a0, (1 - cw) / 2 / a0,
            -2 * cw / a0, (1 - alpha) / a0)


def biquad_bp(fc, q):
    w0 = 2 * math.pi * min(fc, SR * 0.45) / SR
    cw, sw = math.cos(w0), math.sin(w0)
    alpha = sw / (2 * q)
    a0 = 1 + alpha
    return (alpha / a0, 0.0, -alpha / a0, -2 * cw / a0, (1 - alpha) / a0)


def biquad_hp(fc, q):
    w0 = 2 * math.pi * min(fc, SR * 0.45) / SR
    cw, sw = math.cos(w0), math.sin(w0)
    alpha = sw / (2 * q)
    a0 = 1 + alpha
    return ((1 + cw) / 2 / a0, -(1 + cw) / a0, (1 + cw) / 2 / a0,
            -2 * cw / a0, (1 - alpha) / a0)


def run_filter(x, coef_of_block, block=32):
    y = [0.0] * len(x)
    x1 = x2 = y1 = y2 = 0.0
    b0 = b1 = b2 = a1 = a2 = 0.0
    for i, v in enumerate(x):
        if i % block == 0:
            b0, b1, b2, a1, a2 = coef_of_block(i)
        out = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1 = x1, v
        y2, y1 = y1, out
        y[i] = out
    return y


def run_static(x, coefs):
    b0, b1, b2, a1, a2 = coefs
    y = [0.0] * len(x)
    x1 = x2 = y1 = y2 = 0.0
    for i, v in enumerate(x):
        out = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        x2, x1 = x1, v
        y2, y1 = y1, out
        y[i] = out
    return y


def env(n, attack, tau, hold=0.0):
    out = [0.0] * n
    for i in range(n):
        t = i / SR
        if t < attack:
            v = t / attack if attack > 0 else 1.0
        elif t < attack + hold:
            v = 1.0
        else:
            v = math.exp(-(t - attack - hold) / tau)
        out[i] = v
    return out


def noise(n, rng):
    return [rng.uniform(-1.0, 1.0) for _ in range(n)]


def mul(a, b):
    return [x * y for x, y in zip(a, b)]


def add_into(dst, src, gain=1.0, at=0):
    off = int(at * SR)
    for i, v in enumerate(src):
        j = off + i
        if 0 <= j < len(dst):
            dst[j] += v * gain


def sine(f0, f1, dur, gain, phase=0.0, rng=None):
    n = int(SR * dur)
    out = [0.0] * n
    for i in range(n):
        t = i / SR
        f = f0 + (f1 - f0) * (t / dur) if dur > 0 else f0
        out[i] = gain * math.sin(2 * math.pi * f * t + phase)
    return out


def normalize(x, peak=0.97):
    m = max(1e-9, max(abs(v) for v in x))
    k = peak / m
    return [v * k for v in x]


def write_wav(name, samples, dur):
    samples = normalize(samples)
    n = int(SR * dur)
    if len(samples) < n:
        samples += [0.0] * (n - len(samples))
    else:
        samples = samples[:n]
    # 收尾 15ms 淡出防截断咔哒
    fade = int(SR * 0.015)
    for i in range(fade):
        samples[len(samples) - fade + i] *= (fade - i) / fade
    path = os.path.join(OUT_DIR, name + '.wav')
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = bytearray()
        for v in samples:
            s = int(max(-1.0, min(1.0, v)) * 32767)
            frames += struct.pack('<h', s)
        w.writeframes(bytes(frames))
    return path


# ---------------------------------------------------------------- 各音效合成
def make_smg(rng):
    dur = 0.16
    n = int(SR * dur)
    out = [0.0] * n
    nz = noise(n, rng)
    crack = run_filter(nz, lambda i: biquad_bp(3000, 2.0))
    add_into(out, mul(crack, env(n, 0.0003, 0.006)), 1.7)
    body = run_filter(nz, lambda i: biquad_lp(400, 1.0))
    add_into(out, mul(body, env(n, 0.001, 0.03)), 1.2)
    return out, dur


def make_shotgun(rng):
    dur = 0.55
    n = int(SR * dur)
    out = [0.0] * n
    nz = noise(n, rng)
    # 霰弹：宽频、低频更厚、衰减更长
    body = run_filter(nz, lambda i: biquad_lp(240, 0.9))
    add_into(out, mul(body, env(n, 0.001, 0.10)), 1.7)
    crack = run_filter(nz, lambda i: biquad_bp(2200, 1.4))
    add_into(out, mul(crack, env(n, 0.0004, 0.012)), 1.2)
    # 泵动"喀拉"拖尾
    pump = run_filter(nz, lambda i: biquad_bp(1500, 2.5))
    add_into(out, mul(pump, env(n, 0.09, 0.04, hold=0.02)), 0.5)
    return out, dur


def make_headpop(rng):
    """脑浆炸开：先是脆壳"啪"（高频瞬态），再是湿黏的低频"噗呲"（颅内容物喷出）。"""
    dur = 0.30
    n = int(SR * dur)
    out = [0.0] * n
    nz = noise(n, rng)
    # 脆壳：高频啪
    shell = run_filter(nz, lambda i: biquad_bp(4200, 1.8))
    add_into(out, mul(shell, env(n, 0.0003, 0.010)), 2.2)
    # 湿黏主体：低频 + 中频"咕叽"
    wet = run_filter(nz, lambda i: biquad_lp(420, 1.2))
    add_into(out, mul(wet, env(n, 0.004, 0.06)), 1.8)
    # 一点粘液"嗒"声：很低的短促正弦滴落
    goo = sine(160, 90, 0.05, 0.5, rng=rng)
    add_into(out, mul(goo, env(len(goo), 0.01, 0.02)), 1.0, at=0.03)
    return out, dur


def make_blood_land(rng):
    """血液飙出落地：一串细密的湿"滴答"，几滴错开砸下。"""
    dur = 0.35
    n = int(SR * dur)
    out = [0.0] * n
    for k, at in enumerate([0.0, 0.05, 0.11, 0.18, 0.26]):
        nd = int(SR * 0.07)
        nz = noise(nd, rng)
        drop = run_filter(nz, lambda i: biquad_bp(1800 + 300 * (k % 2), 3.0))
        drop = mul(drop, env(nd, 0.0004, 0.018))
        add_into(out, drop, 0.8, at=at)
        # 落地那一瞬的低频"啪"
        th = sine(220, 140, 0.02, 0.35, rng=rng)
        add_into(out, mul(th, env(len(th), 0.001, 0.008)), 1.0, at=at + 0.005)
    return out, dur


def make_shell_drop(rng):
    """弹壳落地：黄铜小壳磕在硬地上，一声尖锐的金属"叮" + 几下弹跳渐弱。

    真实黄铜弹壳落地是"叮——"：极短的高频瞬态（碰撞）叠加一段金属筒壁共振
    （几个非谐波泛音一起衰减），弹跳次数少但每次都有清脆的"叮"。
    """
    dur = 0.45
    n = int(SR * dur)
    out = [0.0] * n

    # 每次落地/弹跳：锐利瞬态 + 金属共振泛音。3 次，间隔渐长、音量渐弱。
    bounces = [
        (0.00, 1.00, 4200, 0.030),
        (0.10, 0.62, 3800, 0.022),
        (0.21, 0.36, 3500, 0.016),
    ]
    for at, g, f0, tau in bounces:
        off = int(at * SR)
        seg = n - off
        if seg <= 0:
            continue
        # 锐利瞬态：高频窄带噪声，极短，模拟壳壁磕地那一下"啪"
        nz = noise(seg, rng)
        click = run_filter(nz, lambda i: biquad_bp(f0, 6.0))
        add_into(out, mul(click, env(seg, 0.0002, 0.004)), 1.6 * g, at=at)
        # 金属共振：筒壁的多个非谐波泛音一起衰减（这才是"叮"的余韵）
        for ratio, rg in ((1.0, 1.0), (1.47, 0.55), (2.11, 0.32), (2.73, 0.20)):
            ring = sine(f0 * ratio, f0 * ratio * 0.985, tau * 3.2, rg, rng=rng)
            add_into(out, mul(ring, env(len(ring), 0.0005, tau)), 0.7 * g, at=at)

    return out, dur


def make_shell_eject(rng):
    """抛壳：枪机里弹壳被顶出的清脆金属"咔"，短促明亮。"""
    dur = 0.12
    n = int(SR * dur)
    out = [0.0] * n
    nz = noise(n, rng)
    click = run_filter(nz, lambda i: biquad_bp(2600, 4.0))
    add_into(out, mul(click, env(n, 0.0003, 0.012)), 1.8)
    mech = run_filter(nz, lambda i: biquad_bp(1400, 3.0))
    add_into(out, mul(mech, env(n, 0.006, 0.02, hold=0.004)), 0.9)
    return out, dur


def make_rack(rng):
    """上膛：拉套筒/泵动。两段金属滑轨"嚓" + 到位"咔"。"""
    dur = 0.22
    n = int(SR * dur)
    out = [0.0] * n
    nz = noise(n, rng)
    # 滑轨拖动（金属摩擦，中频持续）
    slide = run_filter(nz, lambda i: biquad_bp(1100, 1.5))
    add_into(out, mul(slide, env(n, 0.01, 0.05, hold=0.03)), 1.2)
    # 到位"咔"（高频瞬态）
    click = run_filter(nz, lambda i: biquad_bp(2800, 4.0))
    add_into(out, mul(click, env(n, 0.0003, 0.01)), 1.6, at=0.13)
    return out, dur


def make_body_drop(rng):
    """肢体落地：重物砸地（低频"砰"）+ 布料/肉的闷响。"""
    dur = 0.4
    n = int(SR * dur)
    out = [0.0] * n
    nz = noise(n, rng)
    thud = run_filter(nz, lambda i: biquad_lp(180, 0.8))
    add_into(out, mul(thud, env(n, 0.002, 0.06)), 1.8)
    # 肉的湿闷（中低频）
    meat = run_filter(nz, lambda i: biquad_bp(360, 1.0))
    add_into(out, mul(meat, env(n, 0.004, 0.05)), 1.0)
    return out, dur


def make_knife_hit(rng):
    """刀具砍中血肉：利刃入肉的"刷"（高频气音）+ 湿闷"噗"（低频）。"""
    dur = 0.25
    n = int(SR * dur)
    out = [0.0] * n
    nz = noise(n, rng)
    # 破空切入（高频短促）
    slice_ = run_filter(nz, lambda i: biquad_hp(3000, 0.9))
    add_into(out, mul(slice_, env(n, 0.0005, 0.02)), 1.3)
    # 入肉湿闷
    meat = run_filter(nz, lambda i: biquad_lp(300, 1.0))
    add_into(out, mul(meat, env(n, 0.003, 0.05)), 1.7)
    return out, dur


def make_melee_swing(rng):
    """挥刀/挥棍破空：快速划过的"嗖"（中高频噪声扫过）。"""
    dur = 0.18
    n = int(SR * dur)
    out = [0.0] * n
    nz = noise(n, rng)
    # 破空：中高频，先起后落
    whoosh = run_filter(nz, lambda i: biquad_bp(700 + 1400 * (i / n), 1.2))
    e = env(n, 0.03, 0.05)
    e = [e[i] * (0.3 + 0.7 * (i / n)) for i in range(n)]
    add_into(out, mul(whoosh, e), 0.9)
    return out, dur


def make_flesh_hit(rng=None):
    """子弹 / 钝器打进躯干：低沉、湿黏、短促的一声闷"噗"。

    刻意压掉 2kHz 以上的能量，跟 head_hit 的脆响拉开距离——闭着眼也能听出
    "这一枪打在身子上"。独立随机种子，不碰主链 rng（见文件头注释）。
    """
    r = rng or random.Random(20261109)
    dur = 0.14
    n = int(SR * dur)
    out = [0.0] * n
    nz = noise(n, r)
    # 皮肉被顶进去的低频"咚"
    thump = sine(125, 58, 0.09, 0.9, rng=r)
    add_into(out, mul(thump, env(len(thump), 0.002, 0.032)), 1.0)
    # 湿黏主体（300Hz 上下）
    meat = run_filter(nz, lambda i: biquad_bp(320, 0.9))
    add_into(out, mul(meat, env(n, 0.003, 0.036)), 1.7)
    # 更厚的一层低频，撑住"肉"的分量
    low = run_filter(nz, lambda i: biquad_lp(170, 0.8))
    add_into(out, mul(low, env(n, 0.004, 0.055)), 0.9)
    # 一点点布料/皮肤擦过的质感，免得糊成一团纯低频
    cloth = run_filter(nz, lambda i: biquad_bp(1050, 1.3))
    add_into(out, mul(cloth, env(n, 0.0004, 0.010)), 0.35)
    return out, dur


def make_head_hit(rng=None):
    """子弹打中脑袋：又脆又硬的"咔"，和打躯干的闷"噗"完全两码事。

    高频瞬态（颅骨）→ 中高频骨裂 → 一小截湿尾巴（提醒这仍是血肉，不是钢板）。
    比 headpop（击杀时脑袋炸开的湿响）短得多；爆头击杀时两者叠成"啪·噗"的层次。
    """
    r = rng or random.Random(20261110)
    dur = 0.18
    n = int(SR * dur)
    out = [0.0] * n
    nz = noise(n, r)
    crack = run_filter(nz, lambda i: biquad_bp(4200, 2.2))
    add_into(out, mul(crack, env(n, 0.0002, 0.007)), 2.4)
    bone = run_filter(nz, lambda i: biquad_bp(1900, 1.6))
    add_into(out, mul(bone, env(n, 0.0005, 0.020)), 1.4)
    knock = sine(950, 280, 0.045, 0.55, rng=r)
    add_into(out, mul(knock, env(len(knock), 0.001, 0.018)), 1.0, at=0.002)
    wet = run_filter(nz, lambda i: biquad_lp(300, 1.0))
    add_into(out, mul(wet, env(n, 0.006, 0.042)), 0.85)
    return out, dur


def make_door_open(rng=None):
    """开门：木质铰链转动的"吱——呀"，末尾门扇靠墙/到位的轻"咔"。

    中频为主、干净短促；刻意不加重低频冲击，好和"撞门""碎门"一听就分开。
    固定独立随机种子，完全不消耗主链 rng。
    """
    r = random.Random(20261111)
    dur = 0.34
    n = int(SR * dur)
    out = [0.0] * n
    nz = noise(n, r)
    # 铰链：两段中心频率错开的窄带摩擦，错开起手做出转动时的滑音
    hinge_a = run_filter(nz, lambda i: biquad_bp(760, 5.0))
    add_into(out, mul(hinge_a, env(n, 0.035, 0.085, hold=0.02)), 1.35, at=0.01)
    hinge_b = run_filter(nz, lambda i: biquad_bp(1180, 6.0))
    add_into(out, mul(hinge_b, env(n, 0.060, 0.075)), 0.85, at=0.05)
    # 门扇划过空气：只留一点点低频，别让开门声也变成"轰"
    air = run_filter(nz, lambda i: biquad_lp(320, 0.8))
    add_into(out, mul(air, env(n, 0.050, 0.100)), 0.10)
    # 到位的"咔"：短木质撞击 + 一声很轻的木腔共鸣
    knock = run_filter(noise(int(SR * 0.06), r), lambda i: biquad_bp(620, 1.2))
    add_into(out, mul(knock, env(len(knock), 0.0008, 0.016)), 1.5, at=0.245)
    add_into(out, mul(sine(190, 92, 0.07, 0.65), env(int(SR * 0.07), 0.001, 0.030)), 0.55, at=0.245)
    return out, dur


def make_door_slam(rng=None):
    """撞门：身体把整扇门撞倒、门板拍在地上。

    时间上是三段：撞上木板（闷砰）→ 铰链扯脱（咔）→ 整扇拍地（更沉的轰 + 余震）。
    低频主导、时长最长，是三种里最有重量的一声。
    """
    r = random.Random(20261112)
    dur = 0.48
    n = int(SR * dur)
    out = [0.0] * n
    nz = noise(n, r)
    # 1) 肩膀/身体撞上木板
    add_into(out, mul(sine(125, 46, 0.13, 1.0), env(int(SR * 0.13), 0.002, 0.055)), 1.0)
    impact = run_filter(nz, lambda i: biquad_lp(240, 0.9))
    add_into(out, mul(impact, env(n, 0.001, 0.045)), 1.3)
    # 2) 铰链被扯脱的短"咔"
    crack = run_filter(noise(int(SR * 0.045), r), lambda i: biquad_bp(1500, 1.5))
    add_into(out, mul(crack, env(len(crack), 0.0005, 0.012)), 1.1, at=0.035)
    # 3) 整扇门拍地（稍晚一点点，才听得出"倒下去"而不是"撞一下"）
    slam = run_filter(nz, lambda i: biquad_lp(150, 0.8))
    add_into(out, mul(slam, env(int(SR * 0.34), 0.003, 0.110)), 1.5, at=0.115)
    add_into(out, mul(sine(88, 32, 0.26, 1.0), env(int(SR * 0.26), 0.002, 0.100)), 1.2, at=0.115)
    # 4) 门板落地后的一小跳余震
    rattle = run_filter(nz, lambda i: biquad_bp(420, 1.0))
    add_into(out, mul(rattle, env(int(SR * 0.16), 0.004, 0.055)), 0.35, at=0.29)
    return out, dur


def make_door_shatter(rng=None):
    """碎门：霰弹/近战把门板打碎成木屑。

    高频瞬态群（纤维同时断）+ 随机撒开的木片弹跳声，跟另外两种的"整块木头"质感区分开。
    """
    r = random.Random(20261113)
    dur = 0.42
    n = int(SR * dur)
    out = [0.0] * n
    nz = noise(n, r)
    # 爆裂瞬态：高频"咔嚓" + 中频撕裂
    crack = run_filter(nz, lambda i: biquad_bp(3100, 1.8))
    add_into(out, mul(crack, env(n, 0.0002, 0.016)), 2.2)
    splinter = run_filter(nz, lambda i: biquad_bp(1700, 1.2))
    add_into(out, mul(splinter, env(n, 0.0008, 0.055)), 1.3)
    # 一点中低频木腔，免得只剩刺耳的高频
    body = run_filter(nz, lambda i: biquad_lp(520, 0.9))
    add_into(out, mul(body, env(n, 0.001, 0.045)), 0.9)
    add_into(out, mul(sine(260, 110, 0.09, 0.55), env(int(SR * 0.09), 0.001, 0.030)), 0.9)
    # 9 片木屑先后弹开/落地：短促的高频小脉冲随机撒在前 0.26s
    for k in range(9):
        at = 0.025 + r.uniform(0.0, 0.24)
        ln = int(SR * r.uniform(0.010, 0.026))
        freq = r.uniform(1800, 4200)
        chip = run_filter(noise(ln, r), lambda i: biquad_bp(freq, 2.0))
        add_into(out, mul(chip, env(ln, 0.0003, 0.0055)), r.uniform(0.35, 0.80), at=at)
    # 细碎尾巴
    tail = run_filter(nz, lambda i: biquad_bp(2100, 1.0))
    add_into(out, mul(tail, env(int(SR * 0.20), 0.006, 0.075)), 0.28, at=0.20)
    return out, dur


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    only = None
    for a in argv:
        if a.startswith('--only='):
            only = set(a.split('=', 1)[1].split(','))
    rng = random.Random(20261108)
    makers = {
        'smg': make_smg,
        'shotgun': make_shotgun,
        'headpop': make_headpop,
        'blood_land': make_blood_land,
        'shell_drop': make_shell_drop,
        'shell_eject': make_shell_eject,
        'rack': make_rack,
        'body_drop': make_body_drop,
        'knife_hit': make_knife_hit,
        'melee_swing': make_melee_swing,
        # 新增的挂在最后，且用独立 rng —— 不影响上面这些的随机序列
        'flesh_hit': make_flesh_hit,
        'head_hit': make_head_hit,
        # 门的三种破坏：各自固定独立种子，即使全量重跑也不碰主链
        'door_open': make_door_open,
        'door_slam': make_door_slam,
        'door_shatter': make_door_shatter,
    }
    if not os.path.isdir(OUT_DIR):
        os.makedirs(OUT_DIR)
    for name, fn in makers.items():
        if only and name not in only: continue
        samples, dur = fn(rng)
        path = write_wav(name, samples, dur)
        print('%-14s %.2fs  %d 字节' % (name + '.wav', dur, os.path.getsize(path)))
    print('\n生成完毕，接着跑 python tools/make_sfx.py 内嵌。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
