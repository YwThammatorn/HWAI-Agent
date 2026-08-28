import { randomUUID } from 'node:crypto';
import type { AnonymizedSubmission, Submission } from './types.ts';

/**
 * ชั้นที่ 1 — ถอดตัวตนก่อนเข้าชั้น LLM
 *
 * กฎจากตั๋ว 18 ที่โค้ดนี้บังคับให้เป็นจริง:
 *
 *   1. ถอดทุกกรณี ไม่มีสวิตช์ปิด  → ไม่มีพารามิเตอร์ใดปิดการทำงานนี้ได้
 *   2. รหัสแทนตัวต้องสุ่ม ห้าม derive จากรหัสนักศึกษาแม้ผ่าน hash
 *      เพราะ hash คงที่แปลว่าเชื่อมโยงข้ามครั้งได้ = ระบุตัวตนโดยพฤตินัย
 *   3. บังคับที่ตัวสร้าง prompt ไม่ใช่ที่หน้าจอ
 *      → ฟังก์ชันนี้คืน "รายการสตริงต้องห้าม" ออกมาด้วย เพื่อให้ buildPrompt()
 *        เอาไปตรวจซ้ำก่อนยิงออกไปจริง (ดู prompt.ts)
 */

export type AnonymizeResult = {
  anonymized: AnonymizedSubmission;
  /** สตริงที่ห้ามโผล่ใน prompt เด็ดขาด — ใช้ทั้งตอนรันจริงและตอนเทสต์ */
  forbidden: string[];
  /** ตารางถอดรหัสกลับ เก็บไว้ฝั่งฐานข้อมูล ไม่เคยเดินทางไปกับ prompt */
  aliasMap: { alias: string; submissionId: string };
};

/** สตริงที่สั้นเกินไปจะทำให้การตรวจ false positive (เช่น ชื่อ "อร") */
const MIN_FORBIDDEN_LENGTH = 3;

export function anonymize(submission: Submission): AnonymizeResult {
  // สุ่มใหม่ทุกครั้ง ไม่ผูกกับข้อมูลใด ๆ ของนักศึกษา
  const alias = `S-${randomUUID().slice(0, 8)}`;

  const forbidden = collectForbidden(submission);

  const anonymized: AnonymizedSubmission = {
    alias,
    frames: submission.figma.frames.map((f) => ({
      id: f.id,
      // ชื่อเฟรมเป็นข้อความอิสระ นักศึกษาพิมพ์ชื่อตัวเองไว้ได้ จึงต้องกวาดด้วย
      name: scrub(f.name, forbidden),
      bbox: f.bbox,
      texts: f.texts.map((t) => ({ ...t, content: scrub(t.content, forbidden) })),
    })),
    // ภาพส่งต่อทั้งก้อน — ดูข้อจำกัดท้ายไฟล์
    images: submission.images,
  };

  return { anonymized, forbidden, aliasMap: { alias, submissionId: submission.submissionId } };
}

/**
 * รวบรวมทุกช่องที่ระบบ "ถืออยู่" และรู้ว่าระบุตัวตนได้
 * เพิ่มช่องใหม่เมื่อไร ต้องมาเพิ่มที่นี่ที่เดียว
 */
function collectForbidden(s: Submission): string[] {
  const raw = [
    s.student.id,
    s.student.name,
    s.student.email,
    // ส่วนหน้าของอีเมลสถาบัน
    s.student.email.split('@')[0],
    s.groupName,
    s.fileName,
    // เจอจริงจากการตรวจลิงก์ Figma: metadata ที่ตามไฟล์มาโดยเจ้าของไม่รู้ตัว
    s.folderName,
    // นามสกุลไฟล์ตัดออก ไม่งั้นไปลบ ".pdf" ในข้อความปกติ
    s.fileName.replace(/\.[a-z0-9]+$/i, ''),
  ];

  // แตกชื่อ-นามสกุลออกเป็นคำ ๆ ด้วย เพราะนักศึกษามักพิมพ์แค่ชื่อต้น
  const words = s.student.name.split(/\s+/);

  return [...new Set([...raw, ...words])]
    .map((x) => x.trim())
    .filter((x) => x.length >= MIN_FORBIDDEN_LENGTH);
}

function scrub(text: string, forbidden: string[]): string {
  let out = text;
  for (const f of forbidden) {
    out = out.replaceAll(f, '[ถอดออก]');
  }
  return out;
}

/**
 * ด่านสุดท้ายก่อนออกจากเครื่อง — เรียกจาก buildPrompt()
 * โยน error แทนที่จะคืน false เพราะกฎข้อนี้พังแบบเงียบ ๆ ได้
 * ถ้าปล่อยให้เป็นค่าที่คนเรียกเลือกจะเช็กหรือไม่เช็กก็ได้ สักวันจะไม่มีใครเช็ก
 */
export function assertClean(serializedPrompt: string, forbidden: string[]): void {
  const leaked = forbidden.filter((f) => serializedPrompt.includes(f));
  if (leaked.length > 0) {
    throw new Error(
      `prompt มีข้อมูลระบุตัวตนหลุดออกมา ${leaked.length} รายการ: ${JSON.stringify(leaked)}`,
    );
  }
}

/**
 * ข้อจำกัดที่ห้ามกลบ (เขียนไว้ในเอกสาร 01 §4.4.5 ด้วย)
 *
 * ฟังก์ชันนี้ถอดได้เฉพาะ "ข้อมูลระบุตัวตนที่ระบบถืออยู่ในฐานะข้อความ"
 * ถ้านักศึกษาพิมพ์ชื่อตัวเองลงไปในภาพ mockup แล้ว export เป็น PNG
 * ชื่อนั้นอยู่ในพิกเซล ไม่ใช่ในสตริง — โค้ดนี้มองไม่เห็นและถอดไม่ได้
 *
 * นโยบายจึงพูดได้แค่ว่า "ไม่ส่งข้อมูลระบุตัวตนที่ระบบถืออยู่"
 * พูดว่า "โมเดลไม่มีทางรู้ว่าใครทำ" ไม่ได้
 */
