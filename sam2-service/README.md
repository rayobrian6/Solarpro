# SAM 2 Segmentation Service

FastAPI microservice that runs Meta's SAM 2.1 (Segment Anything Model 2) for automatic mask generation from aerial/roof imagery. Deployed on Render GPU and called by the Solarpro Pipeline B segmentation worker.

## Architecture

```
Solarpro (Next.js)
  └─ sam2Client.ts ──HTTP──▶ sam2-service (FastAPI + SAM 2.1)
                                    │
                                    ▼
                              CUDA GPU (T4 / A100)
                              sam2.1_hiera_small (46M params)
                              Automatic Mask Generation
                                    │
                                    ▼
                              Polygon masks + class hints
                              (OpenCV findContours + Douglas-Peucker)
```

## Endpoints

### `POST /segment`

Upload an image and receive segmented polygon masks.

**Request**: Multipart form with `file` field (JPEG/PNG/WebP)

**Query params**:
- `min_area_fraction` (default: 0.02) — minimum mask area as fraction of image
- `max_masks` (default: 20) — maximum masks to return

**Response**:
```json
{
  "success": true,
  "masks": [
    {
      "mask_index": 0,
      "polygon": [{"x": 100, "y": 50}, ...],
      "area": 45000,
      "bbox": [100, 50, 300, 150],
      "confidence": 82,
      "stability_score": 0.95,
      "class_hint": "roof",
      "point_count": 4
    }
  ],
  "mask_count": 3,
  "image_width": 512,
  "image_height": 512,
  "processing_time_ms": 1250,
  "model_info": {
    "checkpoint": "sam2.1_hiera_small",
    "device": "cuda",
    "cuda_available": true,
    "model_type": "sam2.1_automatic_mask_generation"
  }
}
```

### `GET /health`

Check service readiness and model load status.

**Response**:
```json
{
  "status": "ready",
  "model_loaded": true,
  "device": "cuda",
  "checkpoint": "sam2.1_hiera_small",
  "cuda_available": true,
  "uptime_seconds": 3600
}
```

## Local Development

### Prerequisites

- Python 3.11+
- CUDA toolkit 12.4+ (for GPU) or CPU-only PyTorch
- 2GB+ VRAM recommended (sam2.1_hiera_small)

### Setup

```bash
# Create virtual environment
python -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Set environment variables
export SAM2_CHECKPOINT=sam2.1_hiera_small
export SAM2_MIN_MASK_AREA_FRACTION=0.02
export SAM2_MAX_MASKS=20
export SAM2_DOUGLAS_PEUCKER_EPSILON=0.005
export PORT=8000

# Run the service
uvicorn main:app --host 0.0.0.0 --port 8000
```

First run will download the SAM 2.1 checkpoint (~184MB). Subsequent runs use the cached model.

### CPU-only Mode

If you don't have a GPU, the service automatically falls back to CPU. Inference will be slower (~5-10s per image vs ~1-2s on GPU) but works for development and testing.

```bash
# Force CPU even if CUDA is available
export CUDA_VISIBLE_DEVICES=""
```

## Deploy to Render

The `render.yaml` file configures the service for Render's GPU offering:

- **Plan**: `starter-gpu` (NVIDIA T4, 16GB VRAM)
- **Region**: Oregon
- **Auto-sleep**: 15 minutes idle
- **Persistent disk**: 1GB for model weight caching

### Deploy steps

1. Push this directory to your Render-connected repository
2. Render auto-detects the `render.yaml` and builds the Dockerfile
3. Set the `SAM2_SERVICE_URL` env var in your Next.js app to the Render URL
4. The service downloads the checkpoint on first cold start (~30s)

### Cost Estimate

| State | Cost |
|-------|------|
| Active (GPU) | $0.22/hr (T4 starter-gpu) |
| Sleeping | $0.00 |
| Typical monthly | ~$5-15 with auto-sleep |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SAM2_CHECKPOINT` | `sam2.1_hiera_small` | SAM 2 model checkpoint name |
| `SAM2_MIN_MASK_AREA_FRACTION` | `0.02` | Minimum mask area as fraction of image |
| `SAM2_MAX_MASKS` | `20` | Maximum masks per image |
| `SAM2_DOUGLAS_PEUCKER_EPSILON` | `0.005` | Polygon simplification tolerance |
| `PORT` | `8000` | Service port |

## Class Hints

The service provides heuristic class hints based on mask position, geometry, and image layout:

| Hint | Criteria |
|------|----------|
| `sky` | Top 30% of image, large area, low edge density |
| `roof` | Upper-middle region, moderate size, rectangular |
| `wall` | Vertical orientation, below roof region |
| `ground` | Bottom 30% of image, large area |
| `tree` | Irregular boundary, high edge density, outdoor context |
| `obstruction` | Small area on roof region |
| `equipment` | Very small area, rectangular, on roof |
| `unknown` | Doesn't match other criteria |

These are heuristics, not fine-tuned classifications. Future work may include a lightweight classifier head on top of SAM 2 features.

## Integration with Solarpro

In the Next.js app, set `SAM2_SERVICE_URL` to point to this service:

```env
# .env.local
SAM2_SERVICE_URL=https://your-sam2-service.onrender.com
```

The segmentation worker (`runSegmentationWorker.ts`) will:
1. Try SAM 2 first for each photo
2. Fall back to Canny edge detection if SAM 2 is unavailable
3. Report which backend was used via `segmentationBackend: 'sam2' | 'canny'`

## License

SAM 2 is Apache 2.0 licensed by Meta. This service wrapper is part of the Solarpro project.
