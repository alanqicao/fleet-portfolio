# Fleet

Alan Cao's portfolio as a fleet in deep space. Each project is a different starship you can play with, built with Three.js.

Project text and media live in `src/content/` and `public/media/`, copied unchanged from the DEEP FIELD repository.

```bash
npm install
npm run dev      # http://127.0.0.1:4330
npm run build    # type-check, then build to dist/
```

- `src/stage.ts`: sky, planet, lights, bloom, camera stops and pointer input
- `src/stations/`: one file per ship
- `src/kit.ts`: shared hull, engine and material parts
- `src/main.ts`: page content, scroll-to-camera link and the case-study sheet

## Ship models

The six ships, the robot arm, and the props (rocks, ore, crates, containers, pod craft) are CC BY 4.0 models from Sketchfab, credited on the site's About section. The originals stay
out of the build in `models-src/` (ignored by git); the site loads compressed copies from `public/models/`.
To rebuild one:

```bash
npx gltf-transform optimize models-src/<name>/scene.gltf public/models/<name>.glb --texture-size 1024 --texture-compress webp --compress meshopt
```

## Checking the scene

Add `?bench` to the address to get two helpers in the browser console. `benchFrames(stop, frames)` jumps the
camera to a stop (0 is the opening, 1 to 6 the ships) and times that many frames. `benchPoint(stop, x, y, z)`
gives the screen position of a point in that ship's own coordinates, which is how the pointer interactions
were tested.

Props keep their parts separate, so add these flags when rebuilding one:
`--flatten false --join false --simplify false --instance false --palette false --prune false`.
The arm depends on it: `src/rig.ts` turns its joints by part name.

## Phones

Model textures are what fill graphics memory, and a phone browser closes a tab that asks for too much.
`public/models/` holds the full set (about 385 MB of textures once on the graphics card) and
`public/models/lite/` a set with smaller textures (about 97 MB). `src/models.ts` picks the light set on
touch devices and small screens. When adding a model, build both.
