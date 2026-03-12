/**
 * lib/billImagePreprocess.ts
 * Image preprocessing pipeline for utility bill OCR.
 *
 * Applies a sequence of image transformations that dramatically improve
 * Tesseract OCR accuracy on bill photos (phone camera, scanner, fax, etc.).
 *
 * Pipeline:
 *   1. EXIF auto-rotate   — fix portrait/landscape orientation from phone
 *   2. Grayscale          — remove colour noise, reduce file size
 *   3. Resize to ≥2400px  — Tesseract works best at 300+ DPI equivalent
 *   4. Normalise levels   — stretch contrast to fill 0–255 range
 *   5. Sharpen            — improve edge clarity on soft/blurry photos
 *   6. Adaptive threshold — convert to black/white, remove background noise
 *
 * Returns a PNG buffer ready for Tesseract.
 */

export interface PreprocessResult {
  buffer: Buffer;
  originalWidth: number;
  originalHeight: number;
  processedWidth: number;
  processedHeight: number;
  wasResized: boolean;
  log: string[];
}

/**
 * Preprocess a bill image buffer for optimal OCR accuracy.
 * Input: any image format supported by sharp (JPEG, PNG, WEBP, TIFF, etc.)
 * Output: PNG buffer, grayscale, high-contrast, ≥2400px on longest side
 */
export async function preprocessBillImage(
  inputBuffer: Buffer,
  log: string[] = [],
): Promise<PreprocessResult> {
  // Dynamic import — sharp has native bindings, keep out of webpack bundle
  const sharp = (await import('sharp')).default;

  // Step 1: Read metadata (get dimensions + EXIF orientation)
  const meta = await sharp(inputBuffer).metadata();
  const origW = meta.width ?? 0;
  const origH = meta.height ?? 0;
  log.push(`[preprocess] Input: ${origW}×${origH} ${meta.format ?? 'unknown'}, orientation=${meta.orientation ?? 'none'}`);

  // Step 2: Determine target size — upscale if shortest side < 1200px
  const MIN_LONG_SIDE = 2400;
  const longSide = Math.max(origW, origH);
  const scaleFactor = longSide < MIN_LONG_SIDE ? MIN_LONG_SIDE / longSide : 1.0;
  const wasResized = scaleFactor > 1.0;

  const targetW = wasResized ? Math.round(origW * scaleFactor) : origW;
  const targetH = wasResized ? Math.round(origH * scaleFactor) : origH;

  if (wasResized) {
    log.push(`[preprocess] Upscaling ${origW}×${origH} → ${targetW}×${targetH} (×${scaleFactor.toFixed(2)})`);
  }

  // Step 3: Build sharp pipeline
  let pipeline = sharp(inputBuffer, { failOn: 'none' })
    // Auto-rotate based on EXIF orientation tag (handles portrait phone photos)
    .rotate()
    // Resize if needed (lanczos for quality upscale)
    .resize(
      wasResized ? targetW : undefined,
      wasResized ? targetH : undefined,
      { kernel: sharp.kernel.lanczos3, withoutEnlargement: false },
    )
    // Convert to greyscale — removes colour confusion for Tesseract
    .grayscale()
    // Normalize: auto-levels (stretches histogram to 0–255)
    .normalize()
    // Sharpen: mild unsharp mask to crisp up text edges
    .sharpen({ sigma: 1.5, m1: 1.0, m2: 2.0 });

  // Step 4: Convert to PNG (lossless, required for thresholding)
  const pngBuffer = await pipeline.png({ compressionLevel: 1 }).toBuffer();

  // Step 5: Adaptive threshold — binarize the image (black text on white background)
  // Sharp doesn't have native adaptive threshold, so we use a linear threshold
  // which works well for most bill photos with reasonably uniform backgrounds.
  const thresholdBuffer = await sharp(pngBuffer)
    .threshold(128)   // pixels above 128 → white, below → black
    .png({ compressionLevel: 1 })
    .toBuffer();

  // Verify output dimensions
  const outMeta = await sharp(thresholdBuffer).metadata();
  const outW = outMeta.width ?? targetW;
  const outH = outMeta.height ?? targetH;

  log.push(`[preprocess] Output: ${outW}×${outH} PNG, grayscale+threshold, ${Math.round(thresholdBuffer.length / 1024)}KB`);

  return {
    buffer: thresholdBuffer,
    originalWidth: origW,
    originalHeight: origH,
    processedWidth: outW,
    processedHeight: outH,
    wasResized,
    log,
  };
}

/**
 * Preprocess with fallback — if sharp fails for any reason, return original buffer.
 * This prevents preprocessing errors from breaking the entire OCR pipeline.
 */
export async function preprocessBillImageSafe(
  inputBuffer: Buffer,
  log: string[] = [],
): Promise<Buffer> {
  try {
    const result = await preprocessBillImage(inputBuffer, log);
    return result.buffer;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.push(`[preprocess] WARNING: preprocessing failed (${msg}) — using original image`);
    return inputBuffer;
  }
}