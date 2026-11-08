# -*- coding: utf-8 -*-
"""合成手枪枪声（更闷、更响），输出 tools/sfx_src/pistol.wav。

为什么自己合成而不是找录音：这段要的是"闷 + 吵"——低频砸下来、几乎没有高频"啪"。
现成录音基本都是近距离、亮、短的干枪声，压完低频反而不像这个 32px 俯视角的画面。

配方（四层叠起来，再整体过一遍 tanh 饱和）：
  1. body   —— 120→48Hz / 235→90Hz 两个正弦，衰减 75ms，是整个"闷"的主体
  2. blast  —— 白噪声过一条 3500→380Hz 扫频低通（Q 0.9），衰减 90ms，给枪口的厚度
  3. crack  —— 1100Hz 带通噪声，只有 20ms，只用来定"开枪"那一瞬的起手
  4. room   —— 300Hz 低通噪声，20ms 后才进，衰减 180ms，模拟房间里的余响
最后 tanh(1.8x) 饱和：把峰值压住、把中间那层抬起来，听感上"更响"但不炸耳朵。
正好对上用户说的"参考现有的爆头音效"——爆头是 `hit`(420Hz 噪声 + 120→50Hz 方波)
加 `die`(520Hz 噪声 + 150→40Hz 锯齿)，频谱重心也在 300Hz 上下，这套枪声是同一个路子。

用法：
    python tools/synth_pistol.py          # 生成 wav 并打印时长/峰值/响度/频段分布
    python tools/make_sfx.py              # 再把 wav 内嵌进 web/js/sfx_samples.js
"""
import math
import os
import random
import struct
import sys
import wave

SR = 44100
DUR = 0.55
N = int(SR * DUR)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'sfx_src', 'pistol.wav')


# ---------------------------------------------------------------- 基础工具
def biquad_lp(fc, q):
    """RBJ cookbook 低通系数（已按 a0 归一化）。"""
    w0 = 2 * math.pi * min(fc, SR * 0.45) / SR
    cw, sw = math.cos(w0), math.sin(w0)
    alpha = sw / (2 * q)
    a0 = 1 + alpha
    return ((1 - cw) / 2 / a0, (1 - cw) / a0, (1 - cw) / 2 / a0,
            -2 * cw / a0, (1 - alpha) / a0)


def biquad_bp(fc, q):
    """RBJ 带通（0dB 峰值增益）。"""
    w0 = 2 * math.pi * min(fc, SR * 0.45) / SR
    cw, sw = math.cos(w0), math.sin(w0)
    alpha = sw / (2 * q)
    a0 = 1 + alpha
    return (alpha / a0, 0.0, -alpha / a0, -2 * cw / a0, (1 - alpha) / a0)


def run_filter(x, coef_of_block, block=32):
    """逐块更新系数的 IIR（扫频用）。coef_of_block(i) -> (b0,b1,b2,a1,a2)。"""
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


def env(n, attack, tau, hold=0.0):
    """攻击 attack 秒 → 保持 hold 秒 → 指数衰减（时间常数 tau 秒）。"""
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


def band_energies(x):
    """用两级低通估 低/中/高 三段能量占比（够判断"闷不闷"了）。"""
    def energy(sig):
        return sum(v * v for v in sig)
    total = energy(x)
    lo = energy(run_filter(x, lambda i: biquad_lp(300, 0.7)))
    mid = max(0.0, energy(run_filter(x, lambda i: biquad_lp(1500, 0.7))) - lo)
    hi = max(0.0, total - lo - mid)
    return (lo / total if total else 0.0,
            mid / total if total else 0.0,
            hi / total if total else 0.0)


# ---------------------------------------------------------------- 合成
def build():
    rng = random.Random(20261108)
    # 2026-11-08 改"清脆"：起手 crack 提到 2.6kHz、更短更亮，低频 body 压轻、
    # 房间余响砍掉大半，饱和也减到 1.2 —— 从"闷响"变成"干脆的一枪"。
    body = [0.0] * N
    for i in range(N):
        t = i / SR
        f1 = 52 + 60 * math.exp(-t / 0.035)
        f2 = 100 + 120 * math.exp(-t / 0.025)
        body[i] = (math.sin(2 * math.pi * f1 * t) +
                   0.32 * math.sin(2 * math.pi * f2 * t + 0.6))

    e_body = env(N, 0.0012, 0.045)

    # 枪口厚度：白噪声过扫频低通（4200 → 600Hz），起手更亮
    nz = noise(N, rng)
    blast = run_filter(nz, lambda i: biquad_lp(
        4200 * math.exp(-(i / SR) / 0.020) + 600, 1.0))
    e_blast = env(N, 0.001, 0.055)

    # 起手：2600Hz 带通、12ms，就是"清脆"的那一下
    crack = run_filter(nz, lambda i: biquad_bp(2600, 1.8))
    e_crack = env(N, 0.0004, 0.012)

    # 房间余响：砍淡，别再把枪声拖闷
    room = run_filter(nz, lambda i: biquad_lp(360, 0.8))
    e_room = env(N, 0.015, 0.090, hold=0.012)

    mix = [0.0] * N
    for i in range(N):
        mix[i] = (body[i] * e_body[i] * 0.55 +
                  blast[i] * e_blast[i] * 2.10 +
                  crack[i] * e_crack[i] * 2.30 +
                  room[i] * e_room[i] * 0.45)

    # 饱和：轻一点，保住高频瞬态不被压平（清脆的关键）
    drive = 1.2
    sat = [math.tanh(drive * v) for v in mix]

    # 末尾 25ms 淡出，避免截断"咔"
    fade = int(SR * 0.025)
    for i in range(fade):
        sat[N - fade + i] *= (fade - i) / fade

    peak = max(abs(v) for v in sat)
    norm = 0.98 / peak
    return [v * norm for v in sat]


def write_wav(samples, path):
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = bytearray()
        for v in samples:
            s = int(max(-1.0, min(1.0, v)) * 32767)
            frames += struct.pack('<h', s)
        w.writeframes(bytes(frames))


def main():
    x = build()
    write_wav(x, OUT)
    peak = max(abs(v) for v in x)
    rms = math.sqrt(sum(v * v for v in x) / len(x))
    lo, mid, hi = band_energies(x)
    # 前 5ms 就已经过了峰值一半的地方 = 起手有多快
    head = max(abs(v) for v in x[:int(SR * 0.005)])
    print('%s  %.2fs @ %dHz  %d 字节' % (os.path.basename(OUT), len(x) / SR, SR,
                                        os.path.getsize(OUT)))
    print('峰值 %.3f   整体 RMS %.3f   响度(RMS/峰值) %.2f' % (peak, rms, rms / peak))
    print('前 5ms 峰值占比 %.2f（越大起手越硬）' % (head / peak))
    print('频段能量：<300Hz %.0f%%   300~1500Hz %.0f%%   >1500Hz %.0f%%'
          % (lo * 100, mid * 100, hi * 100))
    print('参考：现有爆头音（hit 420Hz 噪声+120→50 方波 / die 520Hz 噪声+150→40 锯齿）'
          '也是低频占大头、几乎没有高频"啪"。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
