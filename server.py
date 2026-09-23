"""Lumacut local server: serves the site and runs the two-stage AI pipeline.

    ./start.sh            → http://localhost:5173

Stage 1  BiRefNet finds the subject (a 1024×1024 probability mask).
Stage 2  A trimap is built from that mask (sure foreground / sure background /
         unknown band around the edges) and ViTMatte solves true transparency
         inside the band at up to MATTE_SIDE px, recovering hair and fur.

Runs on Apple GPUs (MPS), NVIDIA GPUs (CUDA) or the CPU, in half precision on GPUs.
"""

import gc
import io
import json
import mimetypes
import os
import queue
import threading
from concurrent.futures import Future
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
os.environ.setdefault('HF_HOME', str(ROOT / 'models' / 'hf'))
os.environ.setdefault('PYTORCH_ENABLE_MPS_FALLBACK', '1')

import torch  # noqa: E402
import torch.nn.functional as F  # noqa: E402
import torchvision.transforms.functional as TF  # noqa: E402
from PIL import Image  # noqa: E402
from transformers import (  # noqa: E402
    AutoModelForImageSegmentation,
    VitMatteForImageMatting,
    VitMatteImageProcessor,
)

HOST = os.environ.get('HOST', '127.0.0.1')
PORT = int(os.environ.get('PORT', 5173))
MATTE_SIDE = int(os.environ.get('MATTE_SIDE', 1600))
MAX_UPLOAD = 64 * 1024 * 1024
GPU_CACHE_CAP = int(float(os.environ.get('GPU_CACHE_GB', 4)) * 2**30)

# Pinned revisions: BiRefNet ships its own model code (trust_remote_code).
BIREFNET = ('ZhengPeng7/BiRefNet', 'e2bf8e4460fc8fa32bba5ea4d94b3233d367b0e4')
VITMATTE = ('hustvl/vitmatte-base-distinctions-646', 'b58373f8dbbfbeb58157456e2e4949f9f872aa18')

DEVICE = 'cuda' if torch.cuda.is_available() else 'mps' if torch.backends.mps.is_available() else 'cpu'
DTYPE = torch.float16 if DEVICE != 'cpu' else torch.float32

state = {'status': 'starting', 'device': DEVICE, 'model': 'birefnet+vitmatte', 'error': None, 'lastMs': None}
models = {}
jobs = queue.Queue()  # all GPU work runs on one thread (MPS is much faster that way)


def sync():
    if DEVICE == 'mps':
        torch.mps.synchronize()
    elif DEVICE == 'cuda':
        torch.cuda.synchronize()


def release_memory():
    """Keep the GPU allocator cache bounded. ViTMatte's attention buffers are
    large and differ per image size; left alone the cache grows until macOS
    starts swapping. Reusing a warm cache is faster, so only trim above a cap."""
    if DEVICE == 'mps':
        if torch.mps.driver_allocated_memory() > GPU_CACHE_CAP:
            gc.collect()
            torch.mps.empty_cache()
        state['gpuMemMB'] = round(torch.mps.driver_allocated_memory() / 2**20)
    elif DEVICE == 'cuda':
        if torch.cuda.memory_reserved() > GPU_CACHE_CAP:
            gc.collect()
            torch.cuda.empty_cache()
        state['gpuMemMB'] = round(torch.cuda.memory_reserved() / 2**20)


# ---------- models ----------
def load_models():
    try:
        state['status'] = 'loading'
        print(f'Loading models on {DEVICE} (first run downloads ~1.3 GB)…', flush=True)
        birefnet = AutoModelForImageSegmentation.from_pretrained(
            BIREFNET[0], revision=BIREFNET[1], trust_remote_code=True)
        models['birefnet'] = birefnet.to(DEVICE, DTYPE).eval()
        models['processor'] = VitMatteImageProcessor.from_pretrained(VITMATTE[0], revision=VITMATTE[1])
        vitmatte = VitMatteForImageMatting.from_pretrained(VITMATTE[0], revision=VITMATTE[1])
        models['vitmatte'] = vitmatte.to(DEVICE, DTYPE).eval()

        # GPU kernels compile on first real use; do it now, in both orientations,
        # with a textured image so every code path is exercised.
        state['status'] = 'warming'
        print('Warming up…', flush=True)
        noise = Image.effect_noise((MATTE_SIDE, MATTE_SIDE * 2 // 3), 64).convert('RGB')
        for img in (noise, noise.transpose(Image.Transpose.ROTATE_90), noise):
            run_pipeline(img)
            release_memory()
        state['status'] = 'ready'
        print(f"Ready ({state['timings']['birefnet'] + state['timings']['vitmatte']} ms per image).", flush=True)
    except Exception as err:  # surfaced to the browser via /api/status
        state['status'] = 'error'
        state['error'] = str(err)
        raise


def gpu_worker():
    load_models()
    while True:
        image, future = jobs.get()
        try:
            future.set_result(run_pipeline(image))
        except Exception as err:
            future.set_exception(err)
        finally:
            release_memory()


def matte(image):
    future = Future()
    jobs.put((image, future))
    return future.result()


def trimap_from(prob, width, height):
    """prob: (1,1,h,w) in [0,1] → trimap (1,1,H,W) with 0 / 0.5 / 1."""
    p = F.interpolate(prob, size=(height, width), mode='bilinear', align_corners=False)
    k = max(3, round(0.012 * max(width, height))) | 1
    fg = (p > 0.95).float()
    bg = (p < 0.05).float()
    fg = -F.max_pool2d(-fg, k, 1, k // 2)  # erode
    bg = -F.max_pool2d(-bg, k, 1, k // 2)
    trimap = torch.full_like(p, 0.5)
    trimap[fg > 0.5] = 1.0
    trimap[bg > 0.5] = 0.0
    return trimap


@torch.inference_mode()
def run_pipeline(image):
    """PIL RGB image → alpha matte as a PIL 'L' image at the matting resolution."""
    timings = {}
    t = time.time()
    # Stage 1: BiRefNet at its native 1024×1024.
    x = TF.to_tensor(image.resize((1024, 1024), Image.BILINEAR))
    x = TF.normalize(x, [0.485, 0.456, 0.406], [0.229, 0.224, 0.225])[None].to(DEVICE, DTYPE)
    prob = models['birefnet'](x)[-1].sigmoid().float()
    sync(); timings['birefnet'] = time.time() - t; t = time.time()

    # Stage 2: ViTMatte on the unknown band, at up to MATTE_SIDE px.
    scale = min(1.0, MATTE_SIDE / max(image.size))
    w, h = max(1, round(image.width * scale)), max(1, round(image.height * scale))
    work = image if (w, h) == image.size else image.resize((w, h), Image.BICUBIC)
    trimap = trimap_from(prob, w, h)
    tri_img = Image.fromarray((trimap[0, 0].cpu().numpy() * 255).astype('uint8'))
    inputs = models['processor'](images=work, trimaps=tri_img, return_tensors='pt')
    timings['prep'] = time.time() - t; t = time.time()
    alpha = models['vitmatte'](pixel_values=inputs.pixel_values.to(DEVICE, DTYPE)).alphas.float()[..., :h, :w]
    alpha = torch.where(trimap == 1, 1.0, torch.where(trimap == 0, 0.0, alpha)).clamp(0, 1)
    sync(); timings['vitmatte'] = time.time() - t
    state['timings'] = {k: round(v * 1000) for k, v in timings.items()}
    return Image.fromarray((alpha[0, 0].cpu().numpy() * 255 + 0.5).astype('uint8'), 'L')


# ---------- http ----------
PRIVATE = {'models', 'node_modules', '__pycache__'}


class Handler(BaseHTTPRequestHandler):
    server_version = 'Lumacut'

    def log_message(self, fmt, *args):
        if self.path.startswith('/api/matte'):
            super().log_message(fmt, *args)

    def send_json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('content-type', 'application/json')
        self.send_header('cache-control', 'no-store')
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split('?', 1)[0]
        if path == '/api/status':
            return self.send_json(200, state)
        rel = path.lstrip('/') or 'index.html'
        if rel.endswith('/'):
            rel += 'index.html'
        target = (ROOT / rel).resolve()
        parts = target.relative_to(ROOT).parts if target.is_relative_to(ROOT) else ('..',)
        if (not parts or parts[0] in PRIVATE or any(p.startswith('.') for p in parts)
                or target.suffix == '.py' or not target.is_file()):
            self.send_error(404)
            return
        data = target.read_bytes()
        self.send_response(200)
        self.send_header('content-type', mimetypes.guess_type(target.name)[0] or 'application/octet-stream')
        self.send_header('cache-control', 'no-cache')
        self.send_header('content-length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path != '/api/matte':
            return self.send_error(404)
        if state['status'] != 'ready':
            return self.send_json(503, {'error': f"Models are {state['status']}", **state})
        length = int(self.headers.get('content-length') or 0)
        if not 0 < length <= MAX_UPLOAD:
            return self.send_json(413, {'error': 'Image missing or too large'})
        try:
            image = Image.open(io.BytesIO(self.rfile.read(length))).convert('RGB')
        except Exception:
            return self.send_json(400, {'error': 'Could not decode image'})
        try:
            t0 = time.time()
            alpha = matte(image)
            state['lastMs'] = round((time.time() - t0) * 1000)
        except Exception as err:
            return self.send_json(500, {'error': str(err)})
        buf = io.BytesIO()
        alpha.save(buf, 'PNG', compress_level=1)
        body = buf.getvalue()
        self.send_response(200)
        self.send_header('content-type', 'image/png')
        self.send_header('cache-control', 'no-store')
        self.send_header('x-inference-ms', str(state['lastMs']))
        self.send_header('content-length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == '__main__':
    threading.Thread(target=gpu_worker, daemon=True).start()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f'Lumacut running at http://localhost:{PORT}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
