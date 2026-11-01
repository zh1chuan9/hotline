# -*- coding: utf-8 -*-
"""裁一块截图并放大，用来检查角色在实机里的真实观感。"""
import os
import sys
import zlib
import struct

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_assets import C

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load(path):
    d = open(path, "rb").read()
    w, h = struct.unpack(">II", d[16:24])
    idat = b""
    i = 8
    while i < len(d):
        ln = struct.unpack(">I", d[i:i + 4])[0]
        tag = d[i + 4:i + 8]
        if tag == b"IDAT":
            idat += d[i + 8:i + 8 + ln]
        i += 12 + ln
    raw = zlib.decompress(idat)
    stride = w * 4 + 1
    rows = []
    prev = bytearray(w * 4)
    for y in range(h):
        f = raw[y * stride]
        line = bytearray(raw[y * stride + 1:(y + 1) * stride])
        if f == 1:
            for x in range(4, len(line)):
                line[x] = (line[x] + line[x - 4]) & 255
        elif f == 2:
            for x in range(len(line)):
                line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(len(line)):
                a = line[x - 4] if x >= 4 else 0
                line[x] = (line[x] + ((a + prev[x]) >> 1)) & 255
        elif f == 4:
            for x in range(len(line)):
                a = line[x - 4] if x >= 4 else 0
                b = prev[x]
                c = prev[x - 4] if x >= 4 else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        rows.append(line)
        prev = line
    return w, h, rows


def crop(src, x0, y0, x1, y1, k, out):
    w, h, rows = load(os.path.join(ROOT, src))
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(w, x1), min(h, y1)
    cw, ch = x1 - x0, y1 - y0
    c = C(cw * k, ch * k)
    for y in range(ch):
        for x in range(cw):
            px = rows[y0 + y][(x0 + x) * 4:(x0 + x) * 4 + 4]
            col = (px[0], px[1], px[2], 255)
            for dy in range(k):
                for dx in range(k):
                    c.set(x * k + dx, y * k + dy, col)
    c.save(os.path.join(ROOT, "docs", out))


if __name__ == "__main__":
    args = sys.argv[1:]
    if args:
        crop(args[0], int(args[1]), int(args[2]), int(args[3]), int(args[4]),
             int(args[5]), args[6])
    else:
        crop("shots/f00000030.png", 390, 60, 560, 200, 4, "crop.png")
    print("ok")
