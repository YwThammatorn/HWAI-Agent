/**
 * OCR helper — ถอดข้อความจากภาพด้วย Tesseract.js
 *
 * ใช้กับไฟล์ภาพที่อัปโหลด (JPG/PNG) เพื่อให้ pipeline มีข้อความ
 * เหมือนกับที่ PDF reader ให้มา ทำให้ LLM หาหลักฐานได้ง่ายขึ้น
 */

export interface OcrResult {
  /** ข้อความที่ถอดได้ทั้งหมด */
  text: string;
  /** ค่าความมั่นใจ (0-100) */
  confidence: number;
  /** เวลาที่ใช้ (ms) */
  durationMs: number;
}

/**
 * ถอดข้อความจาก base64 image
 * @param imageBase64 - base64 string (ไม่ต้องมี data URL prefix)
 * @param mediaType - MIME type เช่น 'image/jpeg', 'image/png'
 * @returns ข้อความที่ถอดได้
 */
export async function ocrImage(
  imageBase64: string,
  mediaType: string = 'image/jpeg',
): Promise<OcrResult> {
  const { createWorker } = await import('tesseract.js');

  // สร้าง data URL จาก base64
  const dataUrl = `data:${mediaType};base64,${imageBase64}`;

  const started = Date.now();
  const worker = await createWorker('tha+eng');
  try {
    const result = await worker.recognize(dataUrl);
    return {
      text: result.data.text.trim(),
      confidence: result.data.confidence,
      durationMs: Date.now() - started,
    };
  } finally {
    await worker.terminate();
  }
}

/**
 * ถอดข้อความแล้วแบ่งเป็นบล็อก (paragraph)
 * ใช้เมื่อต้องการแยกข้อความเป็นส่วน ๆ ตาม layout ของภาพ
 */
export async function ocrImageByParagraphs(
  imageBase64: string,
  mediaType: string = 'image/jpeg',
): Promise<{ text: string; bbox: { x: number; y: number; w: number; h: number } }[]> {
  const { createWorker } = await import('tesseract.js');

  const dataUrl = `data:${mediaType};base64,${imageBase64}`;

  const worker = await createWorker('tha+eng');
  try {
    const result = await worker.recognize(dataUrl);

    // แปลง blocks เป็น paragraph objects
    const paragraphs: { text: string; bbox: { x: number; y: number; w: number; h: number } }[] = [];

    for (const block of result.data.blocks) {
      for (const paragraph of block.paragraphs) {
        const text = paragraph.text.trim();
        if (text) {
          const bbox = paragraph.bbox;
          paragraphs.push({
            text,
            bbox: {
              x: bbox.x0,
              y: bbox.y0,
              w: bbox.x1 - bbox.x0,
              h: bbox.y1 - bbox.y0,
            },
          });
        }
      }
    }

    return paragraphs;
  } finally {
    await worker.terminate();
  }
}
