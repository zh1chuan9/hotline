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

所有音效先在这里生成 wav，再跑 tools/make_sfx.py 内嵌进 web/js/sfx_samples.js。
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
    """弹壳落地：黄铜小壳在地板上弹跳的"叮叮叮"，几次渐弱。"""
    dur = 0.4
    n = int(SR * dur)
    out = [0.0] * n
    freqs = [2100, 2400, 2000]
    gains = [1.0, 0.65, 0.4]
    ats = [0.0, 0.09, 0.18]
    for f, g, at in zip(freqs, gains, ats):
        nd = int(SR * 0.08)
        nz = noise(nd, rng)
        ding = run_filter(nz, lambda i: biquad_bp(f, 5.0))
        ding = mul(ding, env(nd, 0.0003, 0.025))
        add_into(out, ding, g, at=at)
        # 黄铜壳的金属共振正弦
        ring = sine(f, f * 0.95, 0.05, 0.3, rng=rng)
        add_into(out, mul(ring, env(len(ring), 0.001, 0.02)), 0.6, at=at)
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


def main():
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
    }
    if not os.path.isdir(OUT_DIR):
        os.makedirs(OUT_DIR)
    for name, fn in makers.items():
        samples, dur = fn(rng)
        path = write_wav(name, samples, dur)
        print('%-14s %.2fs  %d 字节' % (name + '.wav', dur, os.path.getsize(path)))
    print('\n生成完毕，接着跑 python tools/make_sfx.py 内嵌。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
