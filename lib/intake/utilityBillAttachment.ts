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
    throw new Error("Unsupported utility bill file type. Upload a PDF or image file.");
  }
  if (file.size <= 0) {
    throw new Error("Utility bill file is empty.");
  }
  if (file.size > MAX_UTILITY_BILL_BYTES) {
    throw new Error("Utility bill file is too large. Maximum size is 10MB.");
  }

  const arrayBuffer = await file.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  const header = new Uint8Array(arrayBuffer, 0, Math.min(12, arrayBuffer.byteLength));
  if (!hasMagicBytes(header, mimeType)) {
    throw new Error("Utility bill file content does not match the declared file type.");
  }

  const uploadedAt = new Date().toISOString();
  const ext = extensionFor(file);
  const safeName = cleanSegment(file.name.replace(/\.[^.]+$/, ""));
  const funnel = cleanSegment(input.funnelSlug || "free-solar-estimate");
  const storageKey = `intake/utility-bills/${funnel}/${input.eventId}/${Date.now()}-${randomUUID()}-${safeName}.${ext}`;
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

  if (blobToken) {
    const { put } = await import("@vercel/blob");
    const blob = await put(storageKey, bytes, {
      access: "public",
      contentType: mimeType,
      token: blobToken,
    });
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

  const uploadsDir = join(process.cwd(), "public", "uploads", "intake", "utility-bills", funnel, input.eventId);
  await mkdir(uploadsDir, { recursive: true });
  const localFileName = `${Date.now()}-${randomUUID()}-${safeName}.${ext}`;
  await writeFile(join(uploadsDir, localFileName), bytes);
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
