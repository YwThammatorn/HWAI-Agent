import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rubric, submission } from '../fixtures/rubric.ts';
import { anonymize } from '../src/anonymize.ts';
import { contrastRatio, runRules, scoreByRule } from '../src/rules.ts';
import type { Criterion, Frame } from '../src/types.ts';

const criterion = (id: string): Criterion => rubric.criteria.find((c) => c.id === id)!;

test('คณิตศาสตร์ contrast ตรงกับค่าที่ตรวจสอบได้จากภายนอก', () => {
  // ค่าสุดขอบสองค่าที่ WCAG นิยามไว้ตรง ๆ
  assert.equal(contrastRatio('#000000', '#ffffff').toFixed(2), '21.00');
  assert.equal(contrastRatio('#ffffff', '#ffffff').toFixed(2), '1.00');

  // #767676 บนขาว คือค่าที่ใช้กันเป็นตัวอย่าง "เทาเข้มสุดที่ยังผ่าน 4.5 : 1"
  assert.ok(contrastRatio('#767676', '#ffffff') >= 4.5);
  assert.ok(contrastRatio('#777777', '#ffffff') < 4.5);

  // สลับ fg/bg ต้องได้ค่าเดียวกัน
  assert.equal(contrastRatio('#123456', '#abcdef'), contrastRatio('#abcdef', '#123456'));

  // เขียนแบบย่อ 3 หลักก็ต้องได้เท่ากัน
  assert.equal(contrastRatio('#fff', '#000'), contrastRatio('#ffffff', '#000000'));
});

test('กฎ required-frames จับหน้าจอที่ขาดได้', () => {
  const findings = runRules(submission.figma, criterion('C2').rule!);
  const missing = findings.filter((f) => !f.pass);

  assert.equal(missing.length, 1);
  assert.match(missing[0].detail, /Checkout/);
});

test('คะแนนจากกฎปัดลงเข้าระดับที่ rubric นิยามไว้ ไม่ปัดใกล้สุด', () => {
  // C2: ครบ 3 จาก 4 หน้า → 0.75 × 3 = 2.25 → ระดับ 2 ไม่ใช่ 2.25 และไม่ใช่ 3
  const s = scoreByRule(criterion('C2'), submission.figma);
  assert.equal(s.score, 2);
  assert.ok(criterion('C2').levels.some((l) => l.score === s.score));
  assert.equal(s.source, 'rule');
  assert.equal(s.producedBy, 'rule:required-frames');
});

test('คะแนนจากกฎต้องเท่าเดิมทุกครั้งที่รัน', () => {
  const runs = Array.from({ length: 5 }, () => scoreByRule(criterion('C1'), submission.figma).score);
  assert.equal(new Set(runs).size, 1, 'ชั้นกฎที่ผลไม่นิ่ง = อธิบายให้นักศึกษาที่ทักท้วงฟังไม่ได้');
});

test('ทุกคะแนนที่ตกต้องมีหลักฐานชี้กลับไปที่เฟรม', () => {
  const s = scoreByRule(criterion('C1'), submission.figma);
  assert.ok(s.evidence.length > 0);
  for (const e of s.evidence) {
    assert.ok(submission.figma.frames.some((f) => f.id === e.frameId));
  }
});

/**
 * เหตุผลที่ชั้นกฎต้องรับ "ข้อมูลดิบ" ไม่ใช่ข้อมูลที่ถอดตัวตนแล้ว
 *
 * เทสต์นี้ไม่ได้เทสต์ฟังก์ชัน แต่เทสต์ "การตัดสินใจเชิงออกแบบ"
 * ถ้าวันหนึ่งมีคนย้ายลำดับให้ถอดตัวตนก่อนเข้าชั้นกฎ (ซึ่งฟังดูปลอดภัยกว่า)
 * เทสต์นี้จะแดงและอธิบายให้ฟังว่าทำไมมันแย่ลง ไม่ใช่ดีขึ้น
 */
test('ถ้าเอาข้อมูลที่ถอดตัวตนแล้วมาเข้าชั้นกฎ นักศึกษาจะเสียคะแนนฟรี', () => {
  // สถานการณ์ที่เกิดขึ้นจริงได้ง่ายมากในไทย: ชื่อเล่นภาษาอังกฤษของนักศึกษา
  // ไปชนกับชื่อหน้าจอที่โจทย์กำหนด — ที่นี่คือนักศึกษาชื่อเล่น "Bank"
  // กับโจทย์ที่สั่งให้มีหน้าเลือกธนาคารชื่อ "Bank"
  const withNickname = {
    ...submission,
    student: { id: '65010999', name: 'ธนกร ใจดี Bank', email: '65010999@kmitl.ac.th' },
    figma: {
      ...submission.figma,
      frames: ['Home', 'Bank'].map<Frame>((name, i) => ({
        id: `f-${i}`,
        name,
        bbox: { x: 0, y: 0, w: 390, h: 844 },
        texts: [],
      })),
    },
  };

  const payment: Criterion = {
    ...criterion('C2'),
    rule: { kind: 'required-frames', names: ['Home', 'Bank'] },
  };

  const { anonymized } = anonymize(withNickname);
  const onRaw = scoreByRule(payment, withNickname.figma);
  const onScrubbed = scoreByRule(payment, anonymized);

  // ทำครบทั้งสองหน้าจริง ๆ
  assert.equal(onRaw.score, 3);
  // แต่พอถอดตัวตนก่อน ชื่อเฟรม "Bank" กลายเป็น "[ถอดออก]" → กฎหาไม่เจอ
  assert.ok(
    onScrubbed.score < onRaw.score,
    'ถ้าเทสต์นี้ไม่แดงอีกต่อไป แปลว่ากฎเปลี่ยนวิธีเทียบชื่อ ต้องกลับไปทบทวนคอมเมนต์ใน rules.ts',
  );
});
