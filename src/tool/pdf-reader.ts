import type { Frame, Submission, TextNode } from '../types.ts';

// pdf-parse จะถูก import แบบ dynamic เพื่อไม่ให้พังถ้าไม่ได้ติดตั้ง
let pdfParse: typeof import('pdf-parse') | null = null;

async function loadPdfParse() {
  if (!pdfParse) {
    pdfParse = await import('pdf-parse');
  }
  return pdfParse.default;
}

/**
 * อ่าน PDF แล้วแปลงเป็น Submission ที่เข้ากันได้กับ pipeline ที่มีอยู่
 *
 * แต่ละหน้า PDF จะกลายเป็น "frame" หนึ่งตัว
 * เนื้อหาข้อความในหน้าจะกลายเป็น TextNode (ไม่มีสี/ขนาด เพราะ PDF ไม่ให้มาง่าย ๆ)
 * ไม่มีรูปภาพ — โมเดล qwen3.8-27b เป็น text-only model
 */
export async function pdfToSubmission(
  pdfBuffer: Buffer,
  fileName: string,
): Promise<Submission> {
  const pdf = await loadPdfParse();
  const data = await pdf(pdfBuffer);

  // แยกข้อความตามหน้า (pdf-parse ใช้ \f คั่นหน้า)
  const pageTexts = data.text.split('\f').filter((t) => t.trim() !== '');

  // ถ้าแยกหน้าไม่ได้ ใช้ทั้งก้อนเป็นหน้าเดียว
  const pages = pageTexts.length > 0 ? pageTexts : [data.text];

  const frames: Frame[] = pages.map((text, i) => ({
    id: `page-${i + 1}`,
    name: `Page ${i + 1}`,
    bbox: { x: 0, y: 0, w: 595, h: 842 }, // A4 size in points
    texts: [
      {
        content: text.trim(),
        fontSizePt: 12, // ค่าปริยาย — ไม่ได้มาจาก PDF โดยตรง
        color: '#000000',
        background: '#ffffff',
      },
    ],
  }));

  // สร้าง Submission ที่ pipeline ใช้ได้
  // ไม่มีนักศึกษาจริง — ใช้ placeholder
  // externalUseConsent = true เพราะต้องส่งออก Groq (API ภายนอก)
  const members = students && students.length > 0
    ? students
    : [{ id: 'pdf-upload', name: 'PDF Upload', email: 'pdf@upload.local' }];

  return {
    submissionId: `pdf-${Date.now()}`,
    student: members[0],
    students: members,
    fileName,
    folderName: '',
    figma: {
      fileKey: '',
      frames,
    },
    images: [], // text-only model ไม่ต้องการภาพ
    externalUseConsent: true,
  };
}
