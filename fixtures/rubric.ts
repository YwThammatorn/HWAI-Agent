import type { Rubric, Submission } from '../src/types.ts';

/**
 * rubric สมมติ 4 เกณฑ์ — 2 เกณฑ์ให้กฎตัดสิน 2 เกณฑ์ให้ LLM ตัดสิน
 * ของจริงต้องมาจาก rubric ที่อาจารย์ใช้สอนจริง (ยังไม่ได้)
 */
export const rubric: Rubric = {
  id: 'rub-ux-wireframe',
  version: 'v1.0',
  assignment: 'Wireframe แอปสั่งอาหารในหอพัก',
  criteria: [
    {
      id: 'C1',
      name: 'ความอ่านออกของตัวอักษร',
      weight: 0.2,
      max: 3,
      layer: 'rule',
      rule: { kind: 'contrast', min: 4.5 },
      cloIds: ['CLO2'],
      levels: [
        { score: 0, label: 'ไม่ผ่าน', anchor: 'มีข้อความที่คอนทราสต์ต่ำกว่าเกณฑ์เกินครึ่ง' },
        { score: 1, label: 'พอใช้', anchor: 'มีข้อความที่คอนทราสต์ต่ำกว่าเกณฑ์บางจุด' },
        { score: 2, label: 'ดี', anchor: 'เกือบทุกข้อความผ่านเกณฑ์' },
        { score: 3, label: 'ดีมาก', anchor: 'ทุกข้อความผ่านเกณฑ์คอนทราสต์ 4.5 : 1' },
      ],
    },
    {
      id: 'C2',
      name: 'ความครบถ้วนของหน้าจอที่โจทย์กำหนด',
      weight: 0.2,
      max: 3,
      layer: 'rule',
      rule: { kind: 'required-frames', names: ['Home', 'Menu', 'Cart', 'Checkout'] },
      cloIds: ['CLO1'],
      levels: [
        { score: 0, label: 'ไม่ผ่าน', anchor: 'ขาดหน้าจอเกินครึ่ง' },
        { score: 1, label: 'พอใช้', anchor: 'ขาด 2 หน้าจอ' },
        { score: 2, label: 'ดี', anchor: 'ขาด 1 หน้าจอ' },
        { score: 3, label: 'ดีมาก', anchor: 'ครบทุกหน้าจอที่โจทย์กำหนด' },
      ],
    },
    {
      id: 'C3',
      name: 'ลำดับสายตาและการจัดกลุ่มข้อมูล',
      weight: 0.3,
      max: 3,
      layer: 'llm',
      cloIds: ['CLO2', 'CLO3'],
      levels: [
        { score: 0, label: 'ไม่ผ่าน', anchor: 'ไม่มีลำดับความสำคัญ ทุกอย่างเด่นเท่ากันหรือจมเท่ากัน' },
        { score: 1, label: 'พอใช้', anchor: 'พอเห็นลำดับ แต่ของสำคัญกับของรองยังแย่งความสนใจกัน' },
        { score: 2, label: 'ดี', anchor: 'ลำดับชัดในหน้าหลัก แต่ไม่สม่ำเสมอทุกหน้า' },
        { score: 3, label: 'ดีมาก', anchor: 'ทุกหน้ามีจุดนำสายตาเดียวที่ชัด และการจัดกลุ่มสอดคล้องกันทั้งงาน' },
      ],
    },
    {
      id: 'C4',
      name: 'ความเหมาะสมของ flow กับงานที่ผู้ใช้ต้องทำ',
      weight: 0.3,
      max: 3,
      layer: 'llm',
      cloIds: ['CLO3'],
      levels: [
        { score: 0, label: 'ไม่ผ่าน', anchor: 'ทำงานหลักให้จบไม่ได้ด้วยหน้าจอที่ให้มา' },
        { score: 1, label: 'พอใช้', anchor: 'ทำจบได้แต่มีขั้นตอนเกินจำเป็นชัดเจน' },
        { score: 2, label: 'ดี', anchor: 'flow สมเหตุสมผล แต่ขาดการรองรับกรณีผิดพลาด' },
        { score: 3, label: 'ดีมาก', anchor: 'flow สั้นที่สุดเท่าที่งานต้องการ และมีทางออกเมื่อผู้ใช้ทำผิด' },
      ],
    },
  ],
};

/** ภาพ PNG 1×1 พิกเซล — ของจริงคือภาพ export จาก Figma ขนาดหลายร้อย KB */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/**
 * ชิ้นงานสมมติ — ตั้งใจใส่ข้อมูลระบุตัวตนไว้ให้ครบทุกช่อง
 * รวมถึงกับดัก: นักศึกษาพิมพ์ชื่อตัวเองไว้ในชื่อเฟรมและในข้อความบนหน้าจอ
 */
export const submission: Submission = {
  submissionId: 'sub-0042',
  student: { id: '65010123', name: 'สมชาย ใจดี', email: '65010123@kmitl.ac.th' },
  groupName: 'กลุ่ม 3 สมชาย-สมหญิง',
  fileName: 'wireframe-สมชาย-final.fig',
  folderName: 'Team project',
  figma: {
    fileKey: 'miz1tFkKs9KjFbOTjwNhfG',
    frames: [
      {
        id: 'frame-1',
        name: 'Home',
        bbox: { x: 0, y: 0, w: 390, h: 844 },
        texts: [
          // คอนทราสต์ 4.54 : 1 → ผ่านหวุดหวิด
          { content: 'สั่งอาหารเลย', fontSizePt: 24, color: '#767676', background: '#ffffff' },
          // คอนทราสต์ 2.85 : 1 → ตก
          { content: 'ร้านใกล้หอ', fontSizePt: 14, color: '#999999', background: '#ffffff' },
        ],
      },
      {
        id: 'frame-2',
        name: 'Menu',
        bbox: { x: 400, y: 0, w: 390, h: 844 },
        texts: [
          { content: 'เมนูแนะนำ', fontSizePt: 20, color: '#111111', background: '#ffffff' },
          // กับดักที่ 1: รหัสนักศึกษาโผล่ในข้อความบนหน้าจอ
          { content: 'ออกแบบโดย 65010123', fontSizePt: 10, color: '#cccccc', background: '#ffffff' },
        ],
      },
      {
        id: 'frame-3',
        name: 'Cart',
        bbox: { x: 800, y: 0, w: 390, h: 844 },
        texts: [{ content: 'ตะกร้าของคุณ', fontSizePt: 18, color: '#222222', background: '#ffffff' }],
      },
      {
        id: 'frame-4',
        // กับดักที่ 2: ชื่อตัวเองอยู่ในชื่อเฟรม
        // (จงใจให้เป็นเฟรมที่โจทย์ไม่ได้บังคับ เพื่อไม่ให้การกวาดชื่อไปกระทบคะแนน C2
        //  ส่วนกรณีที่มันกระทบจริง ๆ มีเทสต์คุมไว้ใน test/rules.test.ts)
        name: 'Profile (แก้โดยสมชาย)',
        bbox: { x: 1200, y: 0, w: 390, h: 844 },
        texts: [{ content: 'โปรไฟล์ของฉัน', fontSizePt: 18, color: '#333333', background: '#ffffff' }],
      },
      // ตั้งใจไม่มีหน้า Checkout → ชั้นกฎต้องจับได้
    ],
  },
  images: [
    { frameId: 'frame-1', mediaType: 'image/png', dataBase64: TINY_PNG },
    { frameId: 'frame-2', mediaType: 'image/png', dataBase64: TINY_PNG },
    { frameId: 'frame-3', mediaType: 'image/png', dataBase64: TINY_PNG },
    { frameId: 'frame-4', mediaType: 'image/png', dataBase64: TINY_PNG },
  ],
  // ไม่ได้ขออนุญาตส่งออกนอกคณะ → AnthropicJudge ต้องปฏิเสธ
  externalUseConsent: false,
};
