import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import { randomUUID } from "crypto";

const MAX_UTILITY_BILL_BYTES = 10 * 1024 * 1024;
const ALLOWED_UTILITY_BILL_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/tiff",
  "image/bmp",
]);

const MIME_EXTENSION: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/tiff": "tif",
  "image/bmp": "bmp",
};

type UtilityBillAttachmentErrorCode =
  | "unsupported_type"
  | "empty_file"
  | "too_large"
  | "content_type_mismatch"
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

function extensionFor(file: File): string {
  const fromMime = MIME_EXTENSION[file.type.toLowerCase()];
  if (fromMime) return fromMime;
  const fromName = file.name.split(".").pop()?.toLowerCase();
  return fromName && /^[a-z0-9]{2,5}$/.test(fromName) ? fromName : "bin";
}

function hasMagicBytes(bytes: Uint8Array, mimeType: string): boolean {
  if (bytes.length < 4) return false;
  if (mimeType === "application/pdf") {
    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  }
  if (mimeType === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/png") {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (mimeType === "image/webp") {
    return bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
  if (mimeType === "image/gif") {
    return bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;
  }
  if (mimeType === "image/tiff") {
    return (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a);
  }
  if (mimeType === "image/bmp") {
    return bytes[0] === 0x42 && bytes[1] === 0x4d;
  }
  return false;
}

export function metadataOnlyUtilityBill(file: File | null): Record<string, unknown> | null {
  if (!file) return null;
  return {
    filename: file.name,
    size_bytes: file.size,
    content_type: file.type || "application/octet-stream",
    storage_status: "metadata_only_not_uploaded",
    accessible_url: null,
    download_url: null,
  };
}

export async function storeUtilityBillAttachment(file: File, input: { eventId: string; funnelSlug?: string | null }): Promise<StoredUtilityBillAttachment> {
  const mimeType = (file.type || "").toLowerCase();
  console.info("[UTILITY BILL UPLOAD]", {
    event_id: input.eventId,
    filename: file.name,
    size_bytes: file.size,
    content_type: mimeType || null,
  });

  if (!ALLOWED_UTILITY_BILL_MIME_TYPES.has(mimeType)) {
    throw new UtilityBillAttachmentError(
      "unsupported_type",
      "Unsupported utility bill file type. Upload a PDF or image file.",
    );
  }
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
  const header = new Uint8Array(arrayBuffer, 0, Math.min(12, arrayBuffer.byteLength));
  if (!hasMagicBytes(header, mimeType)) {
    throw new UtilityBillAttachmentError(
      "content_type_mismatch",
      "Utility bill file content does not match the declared file type.",
    );
  }

  const uploadedAt = new Date().toISOString();
  const ext = extensionFor(file);
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
        contentType: mimeType,
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
      content_type: mimeType,
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
    content_type: mimeType,
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
  });
  return stored;
}
