import type { Criterion, CriterionScore, Frame, RuleSpec } from './types.ts';

/**
 * ชั้นที่ 2 — ชั้นกฎ
 *
 * ของที่วัดได้ตรง ๆ ต้องวัดตรง ๆ ห้ามให้ LLM เดา
 * เหตุผลไม่ใช่เรื่องประหยัด แต่เพราะ **ผลต้องเท่าเดิมทุกครั้งที่รัน**
 * ค่าคอนทราสต์ 2.9 : 1 คือ 2.9 : 1 ไม่ว่าจะรันกี่รอบ อธิบายให้นักศึกษาที่ทักท้วงฟังได้
 * และตอนเขียนบทที่ 4 คะแนนส่วนนี้ไม่มีความแปรปรวนมาปนกับส่วนที่วัดจริง ๆ ว่า AI เก่งแค่ไหน
 *
 * ผลของชั้นนี้ไม่ถูกส่งเข้า prompt (ดู prompt.ts) เพื่อไม่ให้โมเดลถูก anchor
 */

/**
 * ชั้นนี้รับแค่ "ก้อนที่มีเฟรม" ไม่ผูกว่าเป็นข้อมูลดิบหรือข้อมูลที่ถอดตัวตนแล้ว
 *
 * และของจริง **ต้องป้อนข้อมูลดิบ** (ดู grade.ts) เพราะชั้นนี้คำนวณอยู่บนเครื่องคณะ
 * ไม่ได้ส่งอะไรออกไปไหนเลย การป้อนข้อมูลที่ถอดตัวตนแล้วจึงไม่ได้เพิ่มความปลอดภัย
 * มีแต่ทำให้ตรวจผิด — เฟรมชื่อ "Checkout ของสมชาย" พอถูกกวาดชื่อจะกลายเป็น
 * "Checkout ของ[ถอดออก]" แล้วถ้ากฎเทียบชื่อแบบตรงตัว นักศึกษาจะเสียคะแนน
 * จากการถอดตัวตนของเราเอง ไม่ใช่จากงานที่เขาทำ (มีเทสต์คุมไว้ใน test/rules.test.ts)
 */
export type HasFrames = { frames: Frame[] };

export type RuleFinding = {
  frameId: string;
  rule: RuleSpec['kind'];
  pass: boolean;
  detail: string;
};

// ─────────── คณิตศาสตร์ของ WCAG contrast ratio (ของจริง ไม่ใช่ค่าสมมติ) ───────────

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

/** relative luminance ตามนิยามของ WCAG 2.x */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

// ─────────────────────────── ตัวรันกฎ ───────────────────────────

export function runRules(sub: HasFrames, spec: RuleSpec): RuleFinding[] {
  switch (spec.kind) {
    case 'contrast':
      return sub.frames.flatMap((f) =>
        f.texts.map((t) => {
          const ratio = contrastRatio(t.color, t.background);
          return {
            frameId: f.id,
            rule: 'contrast' as const,
            pass: ratio >= spec.min,
            detail: `"${truncate(t.content)}" ได้ ${ratio.toFixed(2)} : 1 (ต้องการ ${spec.min} : 1)`,
          };
        }),
      );

    case 'min-font-size':
      return sub.frames.flatMap((f) =>
        f.texts.map((t) => ({
          frameId: f.id,
          rule: 'min-font-size' as const,
          pass: t.fontSizePt >= spec.minPt,
          detail: `"${truncate(t.content)}" ขนาด ${t.fontSizePt} pt (ต้องการอย่างน้อย ${spec.minPt} pt)`,
        })),
      );

    case 'required-frames': {
      const present = new Set(sub.frames.map((f) => f.name.toLowerCase().trim()));
      return spec.names.map((name) => {
        const hit = sub.frames.find((f) => f.name.toLowerCase().trim() === name.toLowerCase());
        return {
          frameId: hit?.id ?? '-',
          rule: 'required-frames' as const,
          pass: present.has(name.toLowerCase()),
          detail: present.has(name.toLowerCase()) ? `มีหน้า "${name}"` : `ไม่พบหน้า "${name}"`,
        };
      });
    }
  }
}

/**
 * แปลงผลกฎเป็นคะแนน
 *
 * วิธีให้คะแนนคือสัดส่วนที่ผ่าน ปัดลงเข้าระดับที่ rubric นิยามไว้
 * ปัด "ลง" ไม่ใช่ปัดใกล้สุด เพราะระดับใน rubric คือ "ทำได้อย่างน้อยเท่านี้"
 */
export function scoreByRule(criterion: Criterion, sub: HasFrames): CriterionScore {
  if (criterion.layer !== 'rule' || !criterion.rule) {
    throw new Error(`เกณฑ์ ${criterion.id} ไม่ใช่เกณฑ์ของชั้นกฎ`);
  }

  const findings = runRules(sub, criterion.rule);
  const failed = findings.filter((f) => !f.pass);
  const ratio = findings.length === 0 ? 1 : (findings.length - failed.length) / findings.length;

  const levels = [...criterion.levels].sort((a, b) => a.score - b.score);
  const target = ratio * criterion.max;
  const level = levels.reduce((best, l) => (l.score <= target + 1e-9 ? l : best), levels[0]);

  return {
    criterionId: criterion.id,
    score: level.score,
    reason:
      failed.length === 0
        ? `ผ่านทุกจุดที่ตรวจ (${findings.length} จุด)`
        : `ไม่ผ่าน ${failed.length} จาก ${findings.length} จุด`,
    evidence: failed.map((f) => ({ frameId: f.frameId, note: f.detail })),
    source: 'rule',
    producedBy: `rule:${criterion.rule.kind}`,
  };
}

function truncate(s: string, n = 28): string {
  return s.length <= n ? s : s.slice(0, n) + '…';
}
