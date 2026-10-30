# Council service costs across Scotland

An interactive map of what Scotland's 32 councils spend per unit of service (per pupil, per visit, per kilometre, per household), from 2010-11 to 2024-25. Pick one of 21 measures, step through the years, and select a council to compare it with Scotland.

It is plain HTML, CSS and JavaScript. There is no build step, no framework and no request to any other site.

## What it shows

- **Map**: each council coloured by the selected measure. Councils are split into five equal-sized groups, either fitted to the selected year (default) or pooled across every year, so a colour keeps the same meaning as the year changes.
- **Council panel**: the selected council's value, how far it sits above or below Scotland, its rank, and its trend against Scotland since 2010-11.
- **Ranking**: all councils from highest to lowest, with Scotland marked.
- **Measures table**: how the selected council ranks on all 21 measures in the chosen year.
- **Prices**: real values (2024-25 prices) or as reported. Real values are the inflation-adjusted series published in the source data.
- **Table view**: the map data as a table, for screen readers and for checking values.

The page state is kept in the URL (`#m=CHN01&y=2024-25&p=real&s=year&c=Glasgow+City`), so a view can be shared as a link.

## Run it

Open `index.html` in a browser. The data is loaded with ordinary script tags, so it works from disk as well as from a web server.

To publish on GitHub Pages: **Settings, Pages, Deploy from a branch, `main`, `/ (root)`**.

## Data and attribution

| What | Source | Licence |
|---|---|---|
| Unit costs per council and year | [Local Government Benchmarking Framework](https://data.spatialhub.scot/dataset/local_government_benchmarking_framework-is), Improvement Service, via Spatial Hub Scotland | UK Open Government Licence, as stated on the dataset page |
| Council boundaries | [Local Authority Boundaries, Scotland](https://data.test.spatialhub.scot/dataset/local_authority_boundaries-is), Spatial Hub Scotland | Listed as "Open" on the dataset page. Check that page for the exact attribution wording before you publish |

Only the 21 LGBF indicators that are costs in pounds are used. The map and charts show the council figure for each, and the "Scotland" line is the national value published in the LGBF.

## Rebuild the data

The two files in `data/` are generated from the raw downloads by two scripts that use only the Python standard library. Put the raw files in `data/raw/` (git-ignored) and run:

```
python3 scripts/build_data.py data/raw/lgbf_data_table_cash.csv data/raw/lgbf_data_table_real.csv data/lgbf_financial.js
python3 scripts/build_map.py data/raw/geojson_scotland.json data/lgbf_financial.js data/council_paths.js 300
```

`build_map.py` converts the 40 MB boundary file (British National Grid, 1.8 million points) into about 11,000 points of SVG path. Borders shared by two councils are simplified once, so neighbours never gain gaps or overlaps. The last argument is the simplification tolerance in metres.

## Choices and limits

- **Two levels, not three.** Official council-level data stops at the 32 council areas. There is no standard spending data below that, so the map does not drill down further.
- **2025-26 is left out.** It is only partly filled in the source file.
- **Some measures have gaps.** For example, a few councils report no museum visits. They are shown as "No data".
- **Shetland is an inset.** It is drawn beside Orkney, inside a frame, not in its true position. Islands under 0.5 square kilometres are omitted from the drawing.
- **Unit costs are not efficiency scores.** Rural and island delivery, the mix of people served and how a service is provided all change what a unit costs.

## Colour and accessibility

The map ramp, the two line colours and the ranking bars come from a palette that was checked with a validator, in both light and dark mode: lightness steps on the map, and separation under colour-vision deficiency for the line pair. Colour is never the only channel: every value is available in the ranking, the tooltips and the tables, regions can be reached and selected with the keyboard, and Escape clears the selection. Motion respects the reduced-motion setting.

## Licence

No licence has been chosen for the code yet. Add one before others reuse it. The data keeps the licences listed above.
