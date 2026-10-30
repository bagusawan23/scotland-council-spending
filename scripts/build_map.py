"""Topology-preserving simplification of Scottish council boundaries into compact SVG paths.

Shared borders are split into arcs at junctions and each arc is simplified exactly once
(Douglas-Peucker), so neighbouring councils never gain gaps or overlaps along a shared border.
Input coordinates are EPSG:27700 (British National Grid, metres) and are drawn as a planar map.

Usage: python3 -I build_map.py GEOJSON LGBF_DATA OUT_FILE [EPS_METRES] [PREVIEW_SVG]
"""
import json
import os
import sys

src, lgbf_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
EPS_M = float(sys.argv[4]) if len(sys.argv) > 4 else 300.0
PREVIEW = sys.argv[5] if len(sys.argv) > 5 else None

SCALE = 10                       # work in decimetres so every coordinate is an integer
MIN_AREA_M2 = 5e5                # drop islands / holes smaller than 0.5 km2
MIN_AREA_DM2 = MIN_AREA_M2 * SCALE * SCALE
EPS2 = (EPS_M * SCALE) ** 2
M = 100_000_000                  # key packing for (x, y) integer pairs


def lgbf_name(n):
    special = {"City of Edinburgh": "Edinburgh City", "Na h-Eileanan an Iar": "Eilean Siar"}
    return special.get(n, n.replace(" and ", " & "))


def area2(r):
    """Twice the signed area of a closed ring."""
    s = 0
    for i in range(len(r) - 1):
        s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
    return s


# ---------------------------------------------------------------- load + coarse filtering
geo = json.load(open(src, encoding="utf-8"))
features = geo["features"]
total_in = 0
polys = []  # (feature index, [closed rings of integer decimetre tuples]) ; ring 0 is the outer ring

for fi, f in enumerate(features):
    for poly in f["geometry"]["coordinates"]:
        rs = []
        for ri, ring in enumerate(poly):
            total_in += len(ring)
            pts = [(round(p[0] * SCALE), round(p[1] * SCALE)) for p in ring]
            cleaned = [pts[0]]
            for p in pts[1:]:
                if p != cleaned[-1]:
                    cleaned.append(p)
            if cleaned[0] != cleaned[-1]:
                cleaned.append(cleaned[0])
            too_small = len(cleaned) < 4 or abs(area2(cleaned)) / 2 < MIN_AREA_DM2
            if too_small:
                if ri == 0:
                    rs = None
                    break
                continue
            rs.append(cleaned)
        if rs:
            polys.append((fi, rs))

rings = []  # [polygon index, is_hole, open point list]
for pi, (_, rs) in enumerate(polys):
    for ri, r in enumerate(rs):
        rings.append([pi, ri > 0, r[:-1]])

# ---------------------------------------------------------------- which rings use each vertex
mem = {}
for rid, (_, _, pts) in enumerate(rings):
    for x, y in pts:
        k = x * M + y
        v = mem.get(k)
        if v is None:
            mem[k] = rid
        elif isinstance(v, int):
            if v != rid:
                mem[k] = frozenset((v, rid))
        elif rid not in v:
            mem[k] = v | {rid}


# ---------------------------------------------------------------- simplification
def dp(points):
    n = len(points)
    if n <= 2:
        return points
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        x1, y1 = points[i]
        x2, y2 = points[j]
        dx, dy = x2 - x1, y2 - y1
        l2 = dx * dx + dy * dy
        maxd, idx = -1.0, -1
        if l2 == 0:
            for k in range(i + 1, j):
                px, py = points[k]
                d = (px - x1) ** 2 + (py - y1) ** 2
                if d > maxd:
                    maxd, idx = d, k
        else:
            for k in range(i + 1, j):
                px, py = points[k]
                t = (px - x1) * dy - (py - y1) * dx
                d = t * t / l2
                if d > maxd:
                    maxd, idx = d, k
        if maxd > EPS2:
            keep[idx] = True
            stack.append((i, idx))
            stack.append((idx, j))
    return [points[k] for k in range(n) if keep[k]]


cache = {}


def simplify_canon(pts):
    key = (pts[0], pts[-1], len(pts), pts[len(pts) // 2])
    r = cache.get(key)
    if r is None:
        r = dp(pts)
        cache[key] = r
    return r


def process_ring(pts):
    n = len(pts)
    ms = [mem[p[0] * M + p[1]] for p in pts]
    br = [i for i in range(n) if ms[i] != ms[i - 1] or ms[i] != ms[(i + 1) % n]]
    if len(br) < 2:  # isolated ring: anchor on its easternmost points
        for i in sorted(range(n), key=lambda i: (pts[i][0], pts[i][1]), reverse=True):
            if i not in br:
                br.append(i)
            if len(br) >= 2:
                break
        br.sort()
    out = []
    m = len(br)
    for j in range(m):
        a, b = br[j], br[(j + 1) % m]
        arc = pts[a:b + 1] if b > a else pts[a:] + pts[:b + 1]
        rev = arc[0] > arc[-1]
        canon = arc[::-1] if rev else arc
        s = simplify_canon(canon)
        if rev:
            s = s[::-1]
        out.extend(s[:-1])
    return out


kept = {}  # polygon index -> list of closed simplified rings (outer first)
for pi, is_hole, pts in rings:
    new = process_ring(pts)
    if len(new) < 3:
        continue
    closed = new + [new[0]]
    if abs(area2(closed)) / 2 < MIN_AREA_DM2 * 0.6:
        continue
    kept.setdefault(pi, [None, []])
    if is_hole:
        kept[pi][1].append(closed)
    else:
        kept[pi][0] = closed

# ---------------------------------------------------------------- Shetland inset
# Shetland lies far to the north-east; move it beside Orkney (same northern edge) so the map is compact.
def feat_name(pi):
    return features[polys[pi][0]]["properties"]["local_authority"]


shet = [pi for pi in kept if feat_name(pi) == "Shetland Islands" and kept[pi][0]]
ork = [pi for pi in kept if feat_name(pi) == "Orkney Islands" and kept[pi][0]]
shift_y = 0
if shet and ork:
    shift_y = max(p[1] for pi in shet for p in kept[pi][0]) - max(p[1] for pi in ork for p in kept[pi][0])
    for pi in shet:
        o, holes = kept[pi]
        kept[pi] = [[(x, y - shift_y) for x, y in o], [[(x, y - shift_y) for x, y in h] for h in holes]]

# ---------------------------------------------------------------- project to a compact SVG viewBox
outer_pts = [p for pi, (o, _) in kept.items() if o for p in o]
xmin = min(p[0] for p in outer_pts)
xmax = max(p[0] for p in outer_pts)
ymin = min(p[1] for p in outer_pts)
ymax = max(p[1] for p in outer_pts)
s = 10000 / (ymax - ymin)
W, H = round((xmax - xmin) * s), 10000


def proj(ring):
    out = []
    for x, y in ring:
        q = (round((x - xmin) * s), round((ymax - y) * s))
        if not out or q != out[-1]:
            out.append(q)
    if len(out) > 1 and out[0] == out[-1]:
        out.pop()
    return out


def path_of(ring):
    q = proj(ring)
    if len(q) < 3:
        return ""
    d = f"M{q[0][0]} {q[0][1]}l"
    parts = []
    for i in range(1, len(q)):
        parts.append(f"{q[i][0] - q[i - 1][0]} {q[i][1] - q[i - 1][1]}")
    return d + " ".join(parts) + "z"


def centroid(q):
    a = cx = cy = 0.0
    for i in range(len(q)):
        x0, y0 = q[i]
        x1, y1 = q[(i + 1) % len(q)]
        c = x0 * y1 - x1 * y0
        a += c
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    if a == 0:
        return q[0]
    return cx / (3 * a), cy / (3 * a)


by_feature = {}
for pi, (o, holes) in kept.items():
    if o is None:
        continue
    by_feature.setdefault(polys[pi][0], []).append((o, holes))

def load_json_or_js(path):
    text = open(path, encoding="utf-8").read().strip()
    if text.startswith("window."):
        text = text.split("=", 1)[1].rstrip().rstrip(";")
    return json.loads(text)


lgbf_councils = set(load_json_or_js(lgbf_path)["councils"])
councils = []
total_out = 0
inset = None
for fi, f in enumerate(features):
    props = f["properties"]
    parts = by_feature.get(fi, [])
    if props["local_authority"] == "Shetland Islands" and shift_y:
        qs = [q for o, _ in parts for q in proj(o)]
        pad = 80
        inset = {
            "lgbf": "Shetland Islands",
            "box": [min(q[0] for q in qs) - pad, min(q[1] for q in qs) - pad,
                    max(q[0] for q in qs) + pad, max(q[1] for q in qs) + pad],
        }
    d_all = []
    biggest, bigarea = None, -1
    for o, holes in parts:
        for ring in [o] + holes:
            p = path_of(ring)
            if p:
                d_all.append(p)
                total_out += len(ring)
        a = abs(area2(o))
        if a > bigarea:
            bigarea, biggest = a, o
    cxy = centroid(proj(biggest)) if biggest else (0, 0)
    councils.append({
        "code": props["code"],
        "name": props["local_authority"],
        "lgbf": lgbf_name(props["local_authority"]),
        "ha": props["hectares"],
        "cx": round(cxy[0]),
        "cy": round(cxy[1]),
        "d": "".join(d_all),
    })

names = {c["lgbf"] for c in councils}
missing_in_geo = sorted(lgbf_councils - names)
missing_in_lgbf = sorted(names - lgbf_councils)
assert not missing_in_geo and not missing_in_lgbf, (missing_in_geo, missing_in_lgbf)

councils.sort(key=lambda c: c["lgbf"])
out = {
    "viewBox": [W, H],
    "inset": inset,
    "meta": {
        "source": "Local Authority Boundaries - Scotland, Spatial Hub Scotland",
        "licence": "Listed as 'Open' on the Spatial Hub Scotland dataset page; check that page for the attribution wording",
        "crs": "EPSG:27700 (British National Grid), drawn as a planar map",
        "simplification": f"Douglas-Peucker, {EPS_M:g} m tolerance, shared borders simplified once; islands under 0.5 km2 omitted",
    },
    "councils": councils,
}
os.makedirs(os.path.dirname(out_path), exist_ok=True)
payload = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
with open(out_path, "w", encoding="utf-8") as fh:
    # a .js output is a plain script (window.COUNCIL_MAP = ...) so index.html also works when opened from disk
    fh.write(f"window.COUNCIL_MAP = {payload};\n" if out_path.endswith(".js") else payload)

print(f"points in: {total_in:,}  -> points out: {total_out:,}")
print(f"viewBox: {W} x {H}")
print(f"councils: {len(councils)}  names all match LGBF: True")
print(f"output size: {os.path.getsize(out_path):,} bytes")
for c in councils:
    print(f"  {c['lgbf']:22} {len(c['d']):>7} chars")

if PREVIEW:
    shapes = "".join(
        f'<path d="{c["d"]}" fill="hsl({(i * 37) % 360},45%,62%)" fill-rule="evenodd" stroke="#fff" stroke-width="12"/>'
        for i, c in enumerate(councils)
    )
    with open(PREVIEW, "w", encoding="utf-8") as fh:
        fh.write(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W // 8}" height="{H // 8}">'
                 f'<rect width="100%" height="100%" fill="#fff"/>{shapes}</svg>')
