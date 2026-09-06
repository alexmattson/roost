import zlib, struct, math
#!/usr/bin/env python3
"""Generates Roost's nest icons. Run from the repo root: python3 tools/make-icons.py

No image library is used, so there is nothing to install: shapes are rasterised
by hand at 4x and box-downsampled for antialiasing, then written as PNG.
"""


# Supersampled render, then box-downsampled — hard-edged pixels looked crude on
# the old icon and a nest is all curves.
SS = 4

EGGS = [(0.392, 0.556, 0.088, 0.079),
        (0.500, 0.516, 0.092, 0.083),
        (0.608, 0.556, 0.088, 0.079)]

def render(size):
    W = size * SS
    buf = [[[0, 0, 0, 0] for _ in range(W)] for _ in range(W)]
    R = 0.26 * W

    def in_tile(x, y):
        cx = min(max(x, R), W - R)
        cy = min(max(y, R), W - R)
        return (x - cx) ** 2 + (y - cy) ** 2 <= R * R

    def ell(x, y, cx, cy, rx, ry):
        return ((x - cx * W) / (rx * W)) ** 2 + ((y - cy * W) / (ry * W)) ** 2

    NCX, NCY, NRX, NRY = 0.50, 0.655, 0.400, 0.278
    HCX, HCY, HRX, HRY = 0.50, 0.605, 0.250, 0.150

    for yy in range(W):
        for xx in range(W):
            x, y = xx + 0.5, yy + 0.5
            if not in_tile(x, y):
                continue
            t = (x / W + y / W) / 2
            c = [int(0x2a + (0x12 - 0x2a) * t),
                 int(0x21 + (0x14 - 0x21) * t),
                 int(0x13 + (0x1a - 0x13) * t)]

            outer = ell(x, y, NCX, NCY, NRX, NRY)
            hollow = ell(x, y, HCX, HCY, HRX, HRY)

            # Interior of the bowl: its own dark brown, so the nest reads as a
            # container rather than a ring with the tile showing through.
            if hollow <= 1.0:
                shade = min(1.0, hollow)
                c = [int(0x46 - 22 * (1 - shade)), int(0x30 - 16 * (1 - shade)), int(0x1c - 10 * (1 - shade))]

            for (ex, ey, erx, ery) in EGGS:
                d = ell(x, y, ex, ey, erx, ery)
                if d <= 1.0:
                    top = (y / W - (ey - ery)) / (2 * ery)
                    c = [int(0xfa - 26 * top), int(0xf0 - 30 * top), int(0xdc - 34 * top)]
                    if d > 0.74:                    # rim shading separates touching eggs
                        c = [int(v * 0.86) for v in c]

            if outer <= 1.0 and hollow > 1.0:
                depth = (y / W - 0.44) / 0.46
                base = [max(0, int(0xe0 - 74 * depth)),
                        max(0, int(0xa6 - 54 * depth)),
                        max(0, int(0x52 - 26 * depth))]
                # Strands run around the ring rather than across the tile, which is
                # what makes it read as woven instead of striped.
                ang = math.atan2((y - NCY * W) / NRY, (x - NCX * W) / NRX)
                # Twigs wrap around a nest, so the strands run concentrically with a
                # wobble. Radial ones converged at the centre and read as a sunburst.
                radius = math.sqrt(outer)
                wobble = 0.30 * math.sin(ang * 8.0) + 0.14 * math.sin(ang * 17.0 + 0.9)
                weave = math.sin((radius + wobble) * 30.0)
                band = 0.96 + 0.085 * weave
                # thin the rim towards the back so the bowl has a lip
                if outer > 0.90:            # soft outer edge, so it sits on the tile
                    band *= 0.74
                if hollow < 1.10:           # inner lip catches a little shadow
                    band *= 0.80
                if size < 48:
                    band = min(band, 1.0)
                c = [min(255, max(0, int(v * band))) for v in base]

            buf[yy][xx] = c + [255]

    out = []
    for y in range(size):
        row = []
        for x in range(size):
            r = g = b = a = 0
            for dy in range(SS):
                for dx in range(SS):
                    p = buf[y * SS + dy][x * SS + dx]
                    a += p[3]; r += p[0] * p[3]; g += p[1] * p[3]; b += p[2] * p[3]
            row.append((r // a, g // a, b // a, a // (SS * SS)) if a else (0, 0, 0, 0))
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
