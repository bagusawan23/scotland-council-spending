"""Build a compact JSON of LGBF financial (pounds) indicators per council and year.

Usage: python3 -I build_data.py CASH_CSV REAL_CSV OUT_JSON
"""
import csv, json, os, sys

cash_path, real_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]

YEARS_MAX = "2024-25"  # 2025-26 is only partially populated, so it is excluded


def load(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def num(x):
    try:
        return round(float(x), 2)
    except (TypeError, ValueError):
        return None


cash_rows = load(cash_path)
real_rows = load(real_path)

real_idx = {}
real_scot = {}
for r in real_rows:
    key = (r["Indicators_Information_Code"], r["LA_Information_LocalAuthority"], r["LA_Data_LGBF_Year"])
    real_idx[key] = num(r["LA_Data_LA_IndicatorReal"])
    real_scot[(r["Indicators_Information_Code"], r["LA_Data_LGBF_Year"])] = num(r["Scotland_Data_Scotland_Indicator_Real"])

indicators = {}
data = {}
scotland = {}
years = set()

for r in cash_rows:
    if r["Indicators_Information_Category"] != "Financial" or r["Indicators_Information_Unit"] != "Pounds":
        continue
    year = r["LA_Data_LGBF_Year"]
    if year > YEARS_MAX:
        continue
    code = r["Indicators_Information_Code"]
    council = r["LA_Information_LocalAuthority"]
    years.add(year)
    indicators[code] = {
        "code": code,
        "service": r["Indicators_Information_ServiceArea"],
        "title": r["Indicators_Information_Title"],
        "unit": r["Indicators_Information_Unit"],
    }
    cash = num(r["LA_Data_LA_IndicatorCash"])
    real = real_idx.get((code, council, year))
    if cash is not None or real is not None:
        data.setdefault(code, {}).setdefault(council, {})[year] = [cash, real]
    scot_cash = num(r["Scotland_Data_Scotland_Indicator_Cash"])
    scot_real = real_scot.get((code, year))
    if scot_cash is not None or scot_real is not None:
        scotland.setdefault(code, {})[year] = [scot_cash, scot_real]

out = {
    "meta": {
        "source": "Local Government Benchmarking Framework (LGBF), Improvement Service, via Spatial Hub Scotland",
        "licence": "UK Open Government Licence (OGL), as stated on the Spatial Hub Scotland dataset page",
        "values": "[cash, real]; real values are in 2024-25 prices",
        "note": "2025-26 excluded: only partially populated in the source file",
    },
    "years": sorted(years),
    "councils": sorted({c for code in data for c in data[code]}),
    "indicators": sorted(indicators.values(), key=lambda i: (i["service"], i["code"])),
    "data": data,
    "scotland": scotland,
}

os.makedirs(os.path.dirname(out_path), exist_ok=True)
payload = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
with open(out_path, "w", encoding="utf-8") as f:
    # a .js output is a plain script (window.LGBF = ...) so index.html also works when opened from disk
    f.write(f"window.LGBF = {payload};\n" if out_path.endswith(".js") else payload)

print("indicators:", len(out["indicators"]))
print("councils:", len(out["councils"]))
print("years:", out["years"][0], "to", out["years"][-1], f"({len(out['years'])})")
print("file size:", os.path.getsize(out_path), "bytes")
