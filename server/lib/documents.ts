import mammoth from "mammoth";
import type { ExtractInput } from "./anthropic.ts";

const IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

/**
 * Convert an uploaded file (from multer memoryStorage) into an ExtractInput.
 * - PDF        -> document block (base64)
 * - .docx      -> text (extracted with mammoth)
 * - text/*     -> text
 * - image/*    -> image block (base64)
 */
export async function fileToInput(file: {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}): Promise<ExtractInput> {
  const { mimetype, originalname, buffer } = file;
  const name = originalname.toLowerCase();

  if (mimetype === "application/pdf" || name.endsWith(".pdf")) {
    return { kind: "pdf", data: buffer.toString("base64"), filename: originalname };
  }

  if (
    mimetype ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  ) {
    const { value } = await mammoth.extractRawText({ buffer });
    return {
      kind: "text",
      text: `# ${originalname}\n\n${value}`,
    };
  }

  if (IMAGE_TYPES.has(mimetype)) {
    return { kind: "image", data: buffer.toString("base64"), mediaType: mimetype };
  }

  if (mimetype.startsWith("text/") || name.match(/\.(txt|md|csv)$/)) {
    return { kind: "text", text: `# ${originalname}\n\n${buffer.toString("utf-8")}` };
  }

  throw new Error(
    `Unsupported file type "${mimetype}" for ${originalname}. Supported: PDF, .docx, text, and images (jpeg/png/gif/webp).`,
  );
}
