#!/usr/bin/env python3
"""Generates Roost's nest icons. Run from the repo root: python3 tools/make-icons.py

A flat white nest on a solid amber circle. No image library is used, so there is
nothing to install: shapes are rasterised by hand at 4x and box-downsampled for
antialiasing, then written as PNG.
"""

import zlib, struct, math

SS = 4
AMBER = (0xE0, 0x93, 0x22)
WHITE = (0xFF, 0xFF, 0xFF)

# The hollow reaches above the bowl's own top edge, so the ring opens out into a
# cup. Closing it made a tyre rather than a nest.
BOWL = (0.500, 0.630, 0.380, 0.244)      # cx, cy, rx, ry
HOLLOW = (0.500, 0.540, 0.268, 0.180)
# Outer eggs first, centre one last so it sits in front of both.
EGGS = [(0.398, 0.487, 0.074, 0.069),
        (0.602, 0.487, 0.074, 0.069),
        (0.500, 0.455, 0.077, 0.072)]


def render(size):
    W = size * SS
    buf = [[None] * W for _ in range(W)]

    def ell_v(x, y, cx, cy, rx, ry, grow=0.0):
        return ((x - cx * W) / (rx * W + grow)) ** 2 + ((y - cy * W) / (ry * W + grow)) ** 2

    def ell(x, y, cx, cy, rx, ry, grow=0.0):
        return ell_v(x, y, cx, cy, rx, ry, grow) <= 1.0

    # The gap that separates an egg from the rim has to stay visible at 16px, where
    # a fixed fraction of the icon rounds away to nothing.
    gap = max(1.15 * SS, size * SS * 0.019)
    r = W / 2.0 - 0.5

    for yy in range(W):
        for xx in range(W):
            x, y = xx + 0.5, yy + 0.5
            if (x - W / 2.0) ** 2 + (y - W / 2.0) ** 2 > r * r:
                continue
            c = AMBER

            # A bumpy outer edge reads as woven twigs; a clean ellipse read as a bowl.
            ang = math.atan2(y - BOWL[1] * W, x - BOWL[0] * W)
            twig = 1.0 + 0.055 * math.sin(ang * 9.0) + 0.022 * math.sin(ang * 21.0 + 1.1)
            if size < 32:
                twig = 1.0                          # the bumps are noise at this size
            if ell_v(x, y, *BOWL) <= twig and ell_v(x, y, *HOLLOW) > 1.0:
                c = WHITE

            # Halo then fill, one egg at a time: carving every gap first and then
            # filling them all merged the eggs into a single blob.
            for egg in EGGS:
                if ell(x, y, *egg, grow=gap):
                    c = AMBER
                if ell(x, y, *egg):
                    c = WHITE

            buf[yy][xx] = c

    out = []
    for y in range(size):
        row = []
        for x in range(size):
            r_ = g = b = a = 0
            for dy in range(SS):
                for dx in range(SS):
                    p = buf[y * SS + dy][x * SS + dx]
                    if p is None:
                        continue
                    a += 255; r_ += p[0]; g += p[1]; b += p[2]
            n = a // 255
            row.append((r_ // n, g // n, b // n, a // (SS * SS)) if n else (0, 0, 0, 0))
        out.append(row)
    return out


def write_png(path, px):
    size = len(px)
    raw = b''.join(b'\x00' + b''.join(bytes(px[y][x]) for x in range(size)) for y in range(size))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))
    open(path, 'wb').write(data)
    return len(data)


if __name__ == '__main__':
    import sys
    for s in (16, 32, 48, 128):
        n = write_png(f'icons/icon{s}.png', render(s))
        print(f'  icons/icon{s}.png  {n} bytes')
    if len(sys.argv) > 1:                       # optional oversized copy to eyeball
        write_png(sys.argv[1], render(256))
        print(f'  {sys.argv[1]}  256px preview')
