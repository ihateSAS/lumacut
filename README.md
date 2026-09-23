# Lumacut

A background remover inspired by remove.bg's feature set, with its own branding and code.

## Run it

```bash
cd lumacut
./start.sh
```

Open http://localhost:5173. The first run creates a Python environment in `.venv` (PyTorch and friends, a few hundred MB) and downloads the two models (~830 MB) into `models/`. After that it starts in about 20 s and processes an image in 2–4 s on an Apple Silicon Mac. It also runs on NVIDIA GPUs (CUDA) or, slowly, on the CPU.

Settings are environment variables: `PORT` (5173), `MATTE_SIDE` (1600, the matting resolution) and `GPU_CACHE_GB` (4, the GPU memory cache cap).

Without the server (for example on a static host) the app falls back to RMBG-1.4 running in the browser.

## How the AI works

| Stage | What happens | Where |
| --- | --- | --- |
| 1. Segmentation | **BiRefNet** (MIT) finds the subject, giving a 1024×1024 probability mask | `server.py` (GPU, ~0.7 s) |
| 2. Matting | A trimap is built from the mask: sure subject, sure background, and an unknown band around the edges. **ViTMatte** (Apache-2.0, trained on Distinctions-646) solves true alpha in the band at up to 1600 px, recovering hair, fur and whiskers | `server.py` (GPU, ~1.3–2 s) |
| 3. Colour clean-up | Blur-fusion foreground estimation removes the old background colour from semi-transparent pixels, so there are no halos | `js/refine.worker.js` |
| Fallback | Without the server, **RMBG-1.4** runs in the browser, and a guided filter snaps its edges to the photo before stage 3 | `js/engine.js` |

## Features

| Area | What you get |
| --- | --- |
| Input | Upload button, drag & drop anywhere, paste (image or URL), image URL field, sample images |
| AI | BiRefNet + ViTMatte on the local GPU server, or RMBG-1.4 in the browser; colour decontamination; model picker with re-run |
| Result | Removed/Original/Compare views with a drag slider; download as PNG/WebP/JPG at full, half or preview size; copy to clipboard; quick background swatches |
| Editor | Colors and a custom picker, 10 backdrops, your own background photo, blurred original background, erase/restore brush with size and softness, "show original" ghost view, reset to AI result, drop shadow, crop to subject with padding, aspect ratios, undo/redo, zoom and pan, hold to compare |
| My images | Every result from the home page and the bulk editor is saved in IndexedDB (original, mask and edits). `library.html` has search, sort, multi-select ZIP download or delete, re-editing, a storage readout, and a history limit from 25 to 500 (default 100) |
| Bulk | Queue many images using the same AI model picker as the home page; runs 2 at a time on the local server; shared output settings; per-image edit and download; download all as a ZIP; optional saving to My images |
| Developers | `js/sdk.js` exports `removeBackground()`, `getMask()`, `createProject()`, `onStatus()`, with a docs page and a live playground |
| Pricing | An honest free page: what's included, hardware needs, and a comparison with paid cloud services |

## Files

```
index.html        home: hero, workspace, features, use cases, FAQ
bulk.html         bulk editor
library.html      My images (saved history)
developers.html   SDK docs + playground
pricing.html      pricing (free)
css/styles.css    all styles (light + dark)
js/engine.js      model choice, server/browser segmentation, refinement calls
js/refine.worker.js  guided filter (browser fallback) + foreground colour estimation
server.py         static server + BiRefNet/ViTMatte pipeline (POST /api/matte)
start.sh          creates .venv from requirements.txt and starts the server
js/project.js     image + mask + edit state; rendering and export
js/editor.js      full-screen editor
js/app.js         home page logic
js/bulk.js        bulk page logic
js/library.js     My images page logic
js/model-picker.js  shared AI-model picker
js/sdk.js         public SDK
js/common.js      header/footer, input handling, toasts, IndexedDB history
```

## Not included (needs a backend)

User accounts and log-in, paid credits and checkout, a hosted REST API, and desktop or Photoshop plugins. The pricing page and developer docs mark where these would plug in.

## License note

BiRefNet is MIT-licensed and ViTMatte is Apache-2.0. BiRefNet ships its own model code (`trust_remote_code`), pinned to a specific revision in `server.py`. RMBG-1.4, the in-browser fallback, is licensed by BRIA AI for **non-commercial** use only.

Sample images are loaded from Unsplash.
