/**
 * ชนิดข้อมูลกลางของตัวอย่างนี้
 *
 * ตั้งใจให้ตรงกับ data model ในเอกสาร 01 §5 แต่ตัดให้เหลือเฉพาะที่ท่อการตรวจใช้จริง
 * ของจริงจะมีตารางอีกหลายตัว (Course, Section, Enrollment, ...) ซึ่งไม่เกี่ยวกับที่นี่
 */

// ───────────────────────── rubric ─────────────────────────

/** ใครเป็นคนตัดสินเกณฑ์ข้อนี้ — เป็นการตัดสินใจของอาจารย์ตอนสร้าง rubric ไม่ใช่ของระบบ */
export type Layer = 'rule' | 'llm';

export type RuleSpec =
  | { kind: 'contrast'; min: number }
  | { kind: 'min-font-size'; minPt: number }
  | { kind: 'required-frames'; names: string[] };

export type Level = {
  score: number;
  label: string;
  /** ข้อความยึด (anchor) — เป็นตัวที่ทำให้คะแนนจากคนละครั้งเทียบกันได้ */
  anchor: string;
};

export type Criterion = {
  id: string;
  name: string;
  /** น้ำหนักในคะแนนรวมของชิ้นงาน (รวมกันได้ 1.0) */
  weight: number;
  max: number;
  layer: Layer;
  levels: Level[];
  /** มีเฉพาะเกณฑ์ layer === 'rule' */
  rule?: RuleSpec;
  cloIds: string[];
};

export type Rubric = {
  id: string;
  /** RubricVersion — เปลี่ยนข้อความเกณฑ์เมื่อไร เลขนี้ต้องขยับ ไม่งั้นเทียบข้ามรอบไม่ได้ */
  version: string;
  assignment: string;
  criteria: Criterion[];
};

// ───────────────────────── ชิ้นงานที่ส่ง ─────────────────────────

export type Frame = {
  id: string;
  name: string;
  /** พิกัดบนผืนผ้าใบ ใช้ชี้ตำแหน่งหลักฐานกลับไปที่หน้าจอตรวจ */
  bbox: { x: number; y: number; w: number; h: number };
  texts: TextNode[];
};

export type TextNode = {
  content: string;
  fontSizePt: number;
  /** สีตัวอักษร / สีพื้นหลัง เป็น hex เช่น '#767676' */
  color: string;
  background: string;
};

export type RenderedImage = {
  frameId: string;
  mediaType: 'image/png' | 'image/jpeg';
  /** ภาพที่ export มาแล้ว เข้ารหัส base64 — ก้อนนี้แหละที่เดินทางไปหาโมเดล */
  dataBase64: string;
};

/**
 * ชิ้นงานดิบตามที่ระบบเก็บไว้ — มีข้อมูลระบุตัวตนครบ
 * ก้อนนี้ห้ามเข้าใกล้ prompt ทุกกรณี ต้องผ่าน anonymize() ก่อนเสมอ
 */
export type Submission = {
  submissionId: string;
  /** ข้อมูลนักศึกษาคนแรก/ผู้รับผิดชอบ — เพื่อ backward compatibility */
  student: { id: string; name: string; email: string };
  /** สมาชิกทั้งหมดในกลุ่ม (ถ้างานเดี่ยว จะมีแค่ 1 คน ตรงกับ student) */
  students: { id: string; name: string; email: string }[];
  groupName: string;
  fileName: string;
  /** ชื่อโฟลเดอร์ที่ติดมากับไฟล์ Figma โดยเจ้าของไม่รู้ตัว (เจอจริงตอนตรวจลิงก์ใน ticket 07) */
  folderName: string;
  figma: { fileKey: string; frames: Frame[] };
  images: RenderedImage[];
  /**
   * ชิ้นงานนี้ได้รับความยินยอมรายชิ้นให้ส่งออกนอกคณะหรือยัง
   * ค่าปริยายคือ false และ ApiJudge จะปฏิเสธถ้าไม่ใช่ true (ดู judge.ts)
   */
  externalUseConsent?: boolean;
};

/** ชิ้นงานหลังถอดตัวตน — เป็นชนิดคนละตัวโดยตั้งใจ เพื่อให้ตัวตรวจชนิดจับพลาดให้ */
export type AnonymizedSubmission = {
  alias: string;
  frames: { id: string; name: string; bbox: Frame['bbox']; texts: TextNode[] }[];
  images: RenderedImage[];
};

// ───────────────────────── ผลการตรวจ ─────────────────────────

export type Evidence = {
  /** ชี้กลับไปที่เฟรมไหน เพื่อให้หน้าจอตรวจไฮไลต์ได้ */
  frameId: string;
  note: string;
};

export type CriterionScore = {
  criterionId: string;
  score: number;
  reason: string;
  evidence: Evidence[];
  /** ใครให้คะแนนนี้ — ค่านี้คือหัวใจของการสืบย้อนตาม TABEE 1.7 */
  source: 'rule' | 'llm' | 'instructor';
  /** ชื่อโมเดล/กฎที่ใช้ เก็บไว้เพื่อให้รู้ว่าคะแนนนี้มาจากระบบเวอร์ชันไหน */
  producedBy: string;
};

export type TraceEntry = {
  at: string;
  step: string;
  detail: string;
};

export type GradingRecord = {
  submissionId: string;
  rubricId: string;
  rubricVersion: string;
  alias: string;
  scores: CriterionScore[];
  weightedTotal: number;
  /** ยังไม่ใช่คะแนนที่นักศึกษาเห็น — ต้องผ่านการยืนยันของอาจารย์ก่อน */
  status: 'awaiting-instructor';
  trace: TraceEntry[];
};
