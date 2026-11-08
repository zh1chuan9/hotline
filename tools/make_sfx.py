# -*- coding: utf-8 -*-
"""把枪械音效（mp3 / wav）转成游戏内嵌的 base64 资源。

用法：
    python tools/synth_pistol.py        # 先合成手枪枪声（tools/sfx_src/pistol.wav）
    python tools/make_sfx.py            # 用 tools/sfx_src/ 里的源文件重新生成全部采样
    python tools/make_sfx.py pistol=新枪声.mp3   # 临时替换某一个（不覆盖 sfx_src）

内嵌格式不挑：mp3 体积小、wav 能自己合成（这机器上没有 numpy/ffmpeg，枪声是用
tools/synth_pistol.py 纯 Python 算出来的 wav）。decodeAudioData 两种都认。

产出 web/js/sfx_samples.js（`window.SFX_SAMPLES = { 名字: 'base64', ... }`），由
index.html / test.html 在 game.js 之前引入。之所以内嵌而不是丢 assets 里让 fetch 去读：
双击打开 index.html 是 file:// 协议，fetch/XHR 读本地文件会被浏览器按跨域拦掉，
<script src> 不会。

游戏里 `SAMPLES` 表（web/js/game.js）写着每个采样的 trim/len/gain，都是按这里的
实测结果对的：脚本会打印"多长、峰值在哪、前多少秒是静音"，换录音后照着改。
"""
import base64
import glob
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(HERE, 'sfx_src')
OUT = os.path.join(HERE, '..', 'web', 'js', 'sfx_samples.js')


def mp3_info(raw):
    """粗解析 MP3 帧头：返回 (采样率, 时长秒, 帧数)。没有 ffmpeg 时够用了。"""
    i = 0
    if raw[:3] == b'ID3':
        sz = (raw[6] << 21) | (raw[7] << 14) | (raw[8] << 7) | raw[9]
        i = 10 + sz
    br1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    br2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160]
    sr_tab = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}
    frames, total, sr = 0, 0, 44100
    while i < len(raw) - 4:
        if raw[i] != 0xFF or (raw[i + 1] & 0xE0) != 0xE0:
            i += 1
            continue
        ver = (raw[i + 1] >> 3) & 3
        layer = (raw[i + 1] >> 1) & 3
        bidx = (raw[i + 2] >> 4) & 0xF
        sridx = (raw[i + 2] >> 2) & 3
        pad = (raw[i + 2] >> 1) & 1
        if bidx in (0, 15) or sridx == 3 or layer != 1 or ver == 1:
            i += 1
            continue
        br = (br1 if ver == 3 else br2)[bidx]
        sr = sr_tab[ver][sridx]
        spf = 1152 if ver == 3 else 576
        size = int(spf / 8 * br * 1000 / sr) + pad
        if size <= 0:
            i += 1
            continue
        frames += 1
        total += spf
        i += size
    return sr, (total / sr if sr else 0), frames


def wav_info(path):
    """读 wav 头：返回 (采样率, 时长秒, 帧数)。"""
    import wave
    with wave.open(path, 'rb') as w:
        sr = w.getframerate()
        frames = w.getnframes()
    return sr, (frames / sr if sr else 0.0), frames


def collect(argv):
    """名字 -> 源文件。默认把 sfx_src/*.mp3 和 *.wav 全收（文件名即采样名，
    同名时 wav 优先——合成出来的是 wav）。`_old/` 里的归档不会被收。"""
    pairs = {}
    for arg in argv:
        if '=' in arg:
            name, path = arg.split('=', 1)
            pairs[name.strip()] = path
    if not pairs:
        for pat in ('*.mp3', '*.wav'):
            for path in sorted(glob.glob(os.path.join(SRC_DIR, pat))):
                pairs[os.path.splitext(os.path.basename(path))[0]] = path
    return pairs


def main(argv):
    pairs = collect(argv)
    if not pairs:
        print('没有找到源文件，请把 mp3 放进 %s' % SRC_DIR)
        return 1

    chunks = []
    for name in sorted(pairs):
        path = pairs[name]
        raw = open(path, 'rb').read()
        if path.lower().endswith('.wav'):
            sr, dur, frames = wav_info(path)
        else:
            sr, dur, frames = mp3_info(raw)
        b64 = base64.b64encode(raw).decode()
        chunks.append((name, raw, sr, dur, frames, b64))
        print('%-8s %-28s %6d 字节  %.2fs @ %dHz  %d 帧' % (name, os.path.basename(path), len(raw), dur, sr, frames))

    lines = [
        '// 枪械音效采样（源文件在 tools/sfx_src/，由 tools/make_sfx.py 生成，别手改）\n',
        '// 以 base64 内嵌，避免 file:// 下 fetch 被 CORS 拦掉——双击 index.html 也能出声。\n',
        '// 换音效：把新 mp3/wav 丢进 tools/sfx_src/（同名覆盖），重跑 python tools/make_sfx.py。\n',
        '// 手枪枪声是 tools/synth_pistol.py 合成的 wav（更闷更响），想调就改那个脚本。\n',
        'window.SFX_SAMPLES = {\n',
    ]
    for name, raw, sr, dur, frames, b64 in chunks:
        lines.append("  // %s：%.2fs / %d 字节 / %d 帧\n" % (name, dur, len(raw), frames))
        lines.append("  %s:\n" % name)
        for i in range(0, len(b64), 120):
            lines.append("    '" + b64[i:i + 120] + "' +\n")
        lines.append("    '',\n")
    lines.append('};\n')
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(''.join(lines))
    print('\n已写出 %s (%.0fKB, %d 个采样)' % (os.path.relpath(OUT, HERE), os.path.getsize(OUT) / 1024, len(chunks)))
    print('记得对一下 web/js/game.js 里 SAMPLES 表的 trim/len/gain。')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
