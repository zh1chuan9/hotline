# -*- coding: utf-8 -*-
"""把手枪枪声 MP3 转成游戏内嵌的 base64 资源。

用法：
    python tools/make_sfx.py "E:/视频/11月8日.MP3"

产出 web/js/pistol_sfx.js（`window.PISTOL_SFX_B64`），由 index.html / test.html 在
game.js 之前引入。之所以内嵌而不是丢 assets 里让 fetch 去读：双击打开 index.html 时
是 file:// 协议，fetch/XHR 读本地文件会被浏览器按跨域拦掉，<script src> 不会。

换音效时只需要重跑这个脚本，游戏里 GUNSHOT 的 trim/len 参数可能要跟着调：
脚本会把"从第几秒开始有声"打出来，trim 取比它稍大一点的数即可。
"""
import base64
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'web', 'js', 'pistol_sfx.js')


def mp3_info(raw):
    """粗解析 MP3 帧头：返回 (采样率, 时长秒, 帧数)。没 ffmpeg 时够用了。"""
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


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    src = sys.argv[1]
    raw = open(src, 'rb').read()
    sr, dur, frames = mp3_info(raw)
    b64 = base64.b64encode(raw).decode()
    lines = [
        '// 手枪枪声采样（源文件：%s）\n' % os.path.basename(src),
        '// %d 帧 / %.2fs / %d 字节；由 tools/make_sfx.py 生成，改音效请重跑脚本。\n' % (frames, dur, len(raw)),
        '// 以 base64 内嵌，避免 file:// 下 fetch 被 CORS 拦掉——双击 index.html 也能出声。\n',
        'window.PISTOL_SFX_B64 =\n',
    ]
    for i in range(0, len(b64), 120):
        lines.append("  '" + b64[i:i + 120] + "' +\n")
    lines.append("  '';\n")
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(''.join(lines))
    print('源文件 %s' % src)
    print('  %d 字节, %.2fs @ %dHz, %d 帧' % (len(raw), dur, sr, frames))
    print('  已写出 %s (%.0fKB)' % (os.path.relpath(OUT, HERE), os.path.getsize(OUT) / 1024))
    print('提示：游戏里的 GUNSHOT.trim 是"跳过开头静音"的秒数，采样实际起声点约 0.30s。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
