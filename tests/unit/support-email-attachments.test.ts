import {
  getSupportEmailAttachmentLimitError,
  prepareSupportEmailAttachment,
  SUPPORT_EMAIL_MAX_ATTACHMENT_BYTES,
} from "@/lib/utils/support-email-attachments";

describe("support email attachment limits", () => {
  it("allows attachments when their combined raw size stays within the safe JSON payload budget", () => {
    const files = [
      { name: "resume.pdf", size: Math.floor(SUPPORT_EMAIL_MAX_ATTACHMENT_BYTES / 2) },
      { name: "screening.pdf", size: Math.floor(SUPPORT_EMAIL_MAX_ATTACHMENT_BYTES / 2) },
    ];

    expect(getSupportEmailAttachmentLimitError(files)).toBeNull();
  });

  it("rejects a single attachment that exceeds the safe simple-send limit", () => {
    const error = getSupportEmailAttachmentLimitError([
      { name: "large-resume.pdf", size: SUPPORT_EMAIL_MAX_ATTACHMENT_BYTES + 1 },
    ]);

    expect(error).toContain("large-resume.pdf");
    expect(error).toContain("2.75MB");
  });

  it("rejects multiple attachments whose combined size would make the JSON payload too large", () => {
    const error = getSupportEmailAttachmentLimitError([
      { name: "resume.pdf", size: SUPPORT_EMAIL_MAX_ATTACHMENT_BYTES },
      { name: "extra.pdf", size: 1 },
    ]);

    expect(error).toContain("Combined attachments");
    expect(error).toContain("2.75MB");
  });

  it("returns an unchanged file when it already fits with existing attachments", async () => {
    const file = new File(["resume"], "resume.pdf", { type: "application/pdf" });

    const result = await prepareSupportEmailAttachment(file, []);

    expect(result.file).toBe(file);
    expect(result.compressed).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it("compresses an image when the selected file would exceed the remaining attachment budget", async () => {
    const image = new File([new Uint8Array(SUPPORT_EMAIL_MAX_ATTACHMENT_BYTES + 1)], "photo.png", {
      type: "image/png",
    });
    const compressedImage = new File(["small"], "photo.jpg", { type: "image/jpeg" });
    const compressor = jest.fn().mockResolvedValue(compressedImage);

    const result = await prepareSupportEmailAttachment(image, [], compressor);

    expect(compressor).toHaveBeenCalledWith(image, SUPPORT_EMAIL_MAX_ATTACHMENT_BYTES);
    expect(result.file).toBe(compressedImage);
    expect(result.compressed).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("returns an error when a non-image file is too large to send", async () => {
    const pdf = new File([new Uint8Array(SUPPORT_EMAIL_MAX_ATTACHMENT_BYTES + 1)], "resume.pdf", {
      type: "application/pdf",
    });

    const result = await prepareSupportEmailAttachment(pdf, []);

    expect(result.file).toBeNull();
    expect(result.compressed).toBe(false);
    expect(result.error).toContain("resume.pdf");
  });
});
