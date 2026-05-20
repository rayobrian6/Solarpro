import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const MAX_UTILITY_BILL_BYTES = 10 * 1024 * 1024;
const GENERIC_BINARY_MIME = "application/octet-stream";

const MIME_EXTENSION: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/tiff": "tif",
  "image/bmp": "bmp",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/json": "json",
  "application/xml": "xml",
  "text/xml": "xml",
  "application/zip": "zip",
};

type UtilityBillAttachmentErrorCode =
  | "empty_file"
  | "too_large"
  | "storage_unconfigured"
  | "storage_failed";

export class UtilityBillAttachmentError extends Error {
  code: UtilityBillAttachmentErrorCode;

  constructor(code: UtilityBillAttachmentErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "UtilityBillAttachmentError";
    this.code = code;
    if (options && "cause" in options) {
      this.cause = options.cause;
    }
  }
}

export function isUtilityBillStorageFailure(err: unknown): boolean {
  return err instanceof UtilityBillAttachmentError && (
    err.code === "storage_unconfigured" || err.code === "storage_failed"
  );
}

export interface StoredUtilityBillAttachment {
  filename: string;
  size_bytes: number;
  content_type: string;
  original_content_type: string | null;
  detected_content_type: string | null;
  file_extension: string;
  storage_status: "stored";
  storage_provider: "vercel_blob" | "local_public_uploads";
  storage_key: string;
  uploaded_at: string;
  accessible_url: string;
  download_url: string;
}

function cleanSegment(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "utility-bill";
}

function cleanMime(value: string | undefined | null): string | null {
  const normalized = (value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(normalized)) return null;
  return normalized;
}

function originalExtension(fileName: string): string | null {
  const ext = fileName.split(".").pop()?.toLowerCase();
  return ext && /^[a-z0-9]{1,10}$/.test(ext) ? ext : null;
}

function extensionFor(contentType: string, fileName: string): string {
  const fromMime = MIME_EXTENSION[contentType];
  if (fromMime) return fromMime;
  return originalExtension(fileName) || "bin";
}

function detectContentType(bytes: Uint8Array): string | null {
  if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "application/pdf";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return "image/png";
  }
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }
  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return "image/gif";
  }
  if (bytes.length >= 4 && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))) {
    return "image/tiff";
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return "image/bmp";
  }
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return "application/zip";
  }
  return null;
}

function effectiveContentType(file: File, bytes: Uint8Array): { contentType: string; originalContentType: string | null; detectedContentType: string | null } {
  const originalContentType = cleanMime(file.type);
  const detectedContentType = detectContentType(bytes);

  if (detectedContentType) {
    return { contentType: detectedContentType, originalContentType, detectedContentType };
  }

  return {
    contentType: originalContentType || GENERIC_BINARY_MIME,
    originalContentType,
    detectedContentType,
  };
}

export function metadataOnlyUtilityBill(file: File | null): Record<string, unknown> | null {
  if (!file) return null;
  return {
    filename: file.name,
    size_bytes: file.size,
    content_type: cleanMime(file.type) || GENERIC_BINARY_MIME,
    original_content_type: cleanMime(file.type),
    storage_status: "metadata_only_not_uploaded",
    accessible_url: null,
    download_url: null,
  };
}

export async function storeUtilityBillAttachment(file: File, input: { eventId: string; funnelSlug?: string | null }): Promise<StoredUtilityBillAttachment> {
  const originalContentType = cleanMime(file.type);
  console.info("[UTILITY BILL UPLOAD]", {
    event_id: input.eventId,
    filename: file.name,
    size_bytes: file.size,
    content_type: originalContentType,
  });

  if (file.size <= 0) {
    throw new UtilityBillAttachmentError("empty_file", "Utility bill file is empty.");
  }
  if (file.size > MAX_UTILITY_BILL_BYTES) {
    throw new UtilityBillAttachmentError(
      "too_large",
      "Utility bill file is too large. Maximum size is 10MB.",
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  const header = new Uint8Array(arrayBuffer, 0, Math.min(32, arrayBuffer.byteLength));
  const typeInfo = effectiveContentType(file, header);
  const uploadedAt = new Date().toISOString();
  const ext = extensionFor(typeInfo.contentType, file.name);
  const safeName = cleanSegment(file.name.replace(/\.[^.]+$/, ""));
  const funnel = cleanSegment(input.funnelSlug || "free-solar-estimate");
  const storageKey = `intake/utility-bills/${funnel}/${input.eventId}/${Date.now()}-${randomUUID()}-${safeName}.${ext}`;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  const allowLocalFallback = process.env.NODE_ENV !== "production";

  if (blobToken) {
    let blob: { url: string; downloadUrl?: string | null };
    try {
      const { put } = await import("@vercel/blob");
      blob = await put(storageKey, bytes, {
        access: "public",
        contentType: typeInfo.contentType,
        token: blobToken,
      });
    } catch (err) {
      throw new UtilityBillAttachmentError(
        "storage_failed",
        "Utility bill upload storage is temporarily unavailable.",
        { cause: err },
      );
    }
    const stored = {
      filename: file.name,
      size_bytes: file.size,
      content_type: typeInfo.contentType,
      original_content_type: typeInfo.originalContentType,
      detected_content_type: typeInfo.detectedContentType,
      file_extension: ext,
      storage_status: "stored" as const,
      storage_provider: "vercel_blob" as const,
      storage_key: storageKey,
      uploaded_at: uploadedAt,
      accessible_url: blob.url,
      download_url: blob.downloadUrl || blob.url,
    };
    console.info("[ATTACHMENT STORED]", {
      event_id: input.eventId,
      storage_provider: stored.storage_provider,
      storage_key: stored.storage_key,
      size_bytes: stored.size_bytes,
      content_type: stored.content_type,
      original_content_type: stored.original_content_type,
      detected_content_type: stored.detected_content_type,
    });
    return stored;
  }

  if (!allowLocalFallback) {
    throw new UtilityBillAttachmentError(
      "storage_unconfigured",
      "Utility bill upload storage is not configured. Set BLOB_READ_WRITE_TOKEN for production uploads.",
    );
  }

  const uploadsDir = join(process.cwd(), "public", "uploads", "intake", "utility-bills", funnel, input.eventId);
  try {
    await mkdir(uploadsDir, { recursive: true });
  } catch (err) {
    throw new UtilityBillAttachmentError(
      "storage_failed",
      "Utility bill upload storage is temporarily unavailable.",
      { cause: err },
    );
  }
  const localFileName = `${Date.now()}-${randomUUID()}-${safeName}.${ext}`;
  try {
    await writeFile(join(uploadsDir, localFileName), bytes);
  } catch (err) {
    throw new UtilityBillAttachmentError(
      "storage_failed",
      "Utility bill upload storage is temporarily unavailable.",
      { cause: err },
    );
  }
  const publicUrl = `/uploads/intake/utility-bills/${funnel}/${input.eventId}/${localFileName}`;
  const stored = {
    filename: file.name,
    size_bytes: file.size,
    content_type: typeInfo.contentType,
    original_content_type: typeInfo.originalContentType,
    detected_content_type: typeInfo.detectedContentType,
    file_extension: ext,
    storage_status: "stored" as const,
    storage_provider: "local_public_uploads" as const,
    storage_key: `public${publicUrl}`,
    uploaded_at: uploadedAt,
    accessible_url: publicUrl,
    download_url: publicUrl,
  };
  console.info("[ATTACHMENT STORED]", {
    event_id: input.eventId,
    storage_provider: stored.storage_provider,
    storage_key: stored.storage_key,
    size_bytes: stored.size_bytes,
    content_type: stored.content_type,
    original_content_type: stored.original_content_type,
    detected_content_type: stored.detected_content_type,
  });
  return stored;
}
