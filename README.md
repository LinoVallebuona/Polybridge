# Bridgewright

A bridge-building physics puzzle for the browser, inspired by *Poly Bridge*. Lay road across a gap, hold it up with wood, steel, rope and cable, stay under budget, then press **Test** and watch the traffic try to cross.

No install and no dependencies: it is plain HTML, CSS and JavaScript on a `<canvas>`, so it runs on any static host and on phones.

## Play

- **Online:** the GitHub Pages workflow in this repo publishes the game on every push to `main` (see [Deploying](#deploying)).
- **Locally:** `npm start` (or any static file server) and open <http://localhost:8000>. You can also run `npm run build` and open `dist/index.html` straight from disk: it is a single self-contained file.

## How to play

| Action | Mouse / keyboard | Touch |
| --- | --- | --- |
| Lay a beam | Drag from a joint, or click a joint and then click where it should end (keeps chaining) | Drag from a joint, or tap a joint then tap the end point |
| Pick a material | `1`–`6` or the toolbar | Toolbar |
| Attach to the middle of a beam | Start or end a beam on an existing beam: it splits there with a new joint | Same |
| Delete | Double-click or right-click a beam or joint, or the Delete tool (`X`) | Double-tap, or the Delete tool |
| Move a joint | Move tool (`M`), then drag | Move tool, then drag |
| Undo / redo | `Ctrl+Z` / `Ctrl+Y` | Toolbar |
| Pan / zoom | Drag empty space, middle mouse; wheel to zoom; `F` refits | One finger on empty space; pinch |
| Test / back to editing | `Space` | Test button |
| Stress view / slow motion | `S` / `T` | Toolbar |
| Cancel the beam in progress | `Esc` or right-click | – |
| Level select | `L` or the menu button | Menu button |

Rules of the site:

- Vehicles only drive on **road** (and **reinforced road**). Everything else is structure.
- **Rope** and **steel cable** only pull, so they go slack when pushed. **Wood** and **steel** push and pull.
- Each material has a maximum beam length (road and wood 2 m, steel 4 m, rope and cable 10 m) and a price per metre.
- A level is complete when every vehicle reaches the flag and the bridge cost is within budget. A bridge that holds but costs too much is recorded as "over budget".
- **Stars** reward cheap bridges: 1 star for finishing within budget, 2 stars at 85% of the budget or less, 3 stars at 70% or less. The budget bar shows the star marks and the stars your current design would earn.
- **Materials unlock** as you go: levels 1–3 have road and wood, Heavy Duty adds reinforced road and steel, and Hang Loose adds rope and steel cable.
- Your design for each level saves in the browser automatically. **Share** gives you a code (and `#code` link) that loads the design for someone else.

There are 14 levels plus a sandbox with no budget, and eight vehicles: motorbike, car, pickup, van, monster truck, truck, bus and a six-tonne tanker. Levels run from a 6 m starter gap through a crossing with no supports below, uphill and downhill spans and a five-vehicle rush hour, to a 40 m grand finale.

## How it works

`js/physics.js` is a small position-based dynamics engine (XPBD with many substeps and one iteration each):

- Every beam is a distance constraint between two pin joints, with stiffness from the material's axial rigidity and some damping. Rope and cable constraints only act when stretched.
- Gravity eases in over the first 0.8 s so a bridge settles under its own weight without a shock.
- A beam snaps once the axial force it carries, lightly smoothed, exceeds its material's strength. A broken beam leaves a swinging stub on each joint.
- Vehicles are rigid four-particle frames. Their wheels collide with road beams and terrain, push back on the bridge joints, and drive through friction-limited traction.

`js/levels.js` defines the levels (terrain polygons, anchors, budget, vehicles). `js/game.js` holds the editor, renderer, input handling and UI.

## Tests

```sh
npm test
```

`test/sim-test.js` runs reference bridges for every level headlessly. It checks that naive designs fail, that sensible ones pass, and that each level has at least one passing design within its budget. Use it after changing materials, vehicles or level budgets.

## Deploying

`.github/workflows/pages.yml` runs the tests, builds `dist/`, and deploys it to GitHub Pages on pushes to `main`/`master`. To turn it on, open the repository's **Settings → Pages** and set **Source** to **GitHub Actions**. The game is also a static site, so `index.html`, `style.css` and `js/` (or the single built `dist/index.html`) can be served from any static host.

## License

MIT
