const BYTES_PER_MB = 1024 * 1024;

export const SUPPORT_EMAIL_MAX_ATTACHMENT_BYTES = 2.75 * BYTES_PER_MB;
export const SUPPORT_EMAIL_MAX_JSON_PAYLOAD_BYTES = 4 * BYTES_PER_MB;
export const SUPPORT_EMAIL_MAX_ATTACHMENT_LABEL = "2.75MB";
export const SUPPORT_EMAIL_MAX_JSON_PAYLOAD_LABEL = "4MB";

export interface SupportEmailAttachmentCandidate {
  name: string;
  size: number;
}

export interface PreparedSupportEmailAttachment {
  file: File | null;
  compressed: boolean;
  error?: string;
}

export type SupportEmailAttachmentCompressor = (
  file: File,
  maxBytes: number,
) => Promise<File | null>;

export function getSupportEmailAttachmentLimitError(
  attachments: SupportEmailAttachmentCandidate[],
): string | null {
  const oversizedAttachment = attachments.find(
    (attachment) => attachment.size > SUPPORT_EMAIL_MAX_ATTACHMENT_BYTES,
  );

  if (oversizedAttachment) {
    return `${oversizedAttachment.name} is too large. Each support email attachment must be ${SUPPORT_EMAIL_MAX_ATTACHMENT_LABEL} or less.`;
  }

  const totalAttachmentBytes = attachments.reduce(
    (total, attachment) => total + attachment.size,
    0,
  );

  if (totalAttachmentBytes > SUPPORT_EMAIL_MAX_ATTACHMENT_BYTES) {
    return `Combined attachments are too large. Resume plus additional attachment must be ${SUPPORT_EMAIL_MAX_ATTACHMENT_LABEL} or less.`;
  }

  return null;
}

function isCompressibleImage(file: File): boolean {
  return file.type.startsWith("image/");
}

export async function compressImageAttachment(
  file: File,
  maxBytes: number,
): Promise<File | null> {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    return null;
  }

  const image = new Image();
  const objectUrl = URL.createObjectURL(file);

  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Unable to load image for compression"));
      image.src = objectUrl;
    });

    let width = image.naturalWidth;
    let height = image.naturalHeight;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");

    if (!width || !height || !context) {
      return null;
    }

    const outputName = file.name.replace(/\.[^.]+$/, "") || "attachment";

    for (let quality = 0.82; quality >= 0.45; quality -= 0.08) {
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", quality);
      });

      if (blob && blob.size <= maxBytes && blob.size < file.size) {
        return new File([blob], `${outputName}.jpg`, {
          type: "image/jpeg",
          lastModified: Date.now(),
        });
      }

      width *= 0.86;
      height *= 0.86;
    }
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }

  return null;
}

export async function prepareSupportEmailAttachment(
  file: File,
  existingAttachments: SupportEmailAttachmentCandidate[],
  compressor: SupportEmailAttachmentCompressor = compressImageAttachment,
): Promise<PreparedSupportEmailAttachment> {
  const existingAttachmentBytes = existingAttachments.reduce(
    (total, attachment) => total + attachment.size,
    0,
  );
  const remainingBytes = SUPPORT_EMAIL_MAX_ATTACHMENT_BYTES - existingAttachmentBytes;

  if (remainingBytes <= 0) {
    return {
      file: null,
      compressed: false,
      error: `Combined attachments are too large. Resume plus additional attachment must be ${SUPPORT_EMAIL_MAX_ATTACHMENT_LABEL} or less.`,
    };
  }

  const maxBytes = Math.min(SUPPORT_EMAIL_MAX_ATTACHMENT_BYTES, remainingBytes);

  if (file.size <= maxBytes) {
    return { file, compressed: false };
  }

  if (isCompressibleImage(file)) {
    const compressedFile = await compressor(file, maxBytes);

    if (compressedFile && compressedFile.size <= maxBytes) {
      return { file: compressedFile, compressed: true };
    }

    return {
      file: null,
      compressed: false,
      error: `${file.name} could not be compressed below ${SUPPORT_EMAIL_MAX_ATTACHMENT_LABEL}. Try a smaller image or PDF.`,
    };
  }

  return {
    file: null,
    compressed: false,
    error: `${file.name} is too large. Each support email attachment must be ${SUPPORT_EMAIL_MAX_ATTACHMENT_LABEL} or less.`,
  };
}
