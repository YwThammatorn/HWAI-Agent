import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { rubric, submission } from '../fixtures/rubric.ts';
import { anonymize, assertClean } from '../src/anonymize.ts';
import { buildPrompt } from '../src/prompt.ts';

/**
 * เทสต์ชุดนี้คือข้อบังคับจากตั๋ว 18 ที่กลายเป็นโค้ด
 * ถ้าชุดนี้แดง แปลว่านโยบาย PDPA ที่เขียนไว้ในเอกสาร 01 §4.4 เป็นแค่คำพูด
 */

test('prompt ที่จะยิงออกไปต้องไม่มีข้อมูลระบุตัวตนสักตัว', () => {
  const { anonymized, forbidden } = anonymize(submission);
  const prompt = buildPrompt(rubric, anonymized, forbidden);

  // ตรวจทุกส่วนที่เป็นข้อความ (ภาพเป็นพิกเซล ตรวจด้วยวิธีนี้ไม่ได้ — ดูเทสต์ล่างสุด)
  const wire = JSON.stringify({
    system: prompt.system,
    instruction: prompt.instruction,
    schema: prompt.schema,
    criteria: prompt.criteria,
  });

  for (const secret of [
    submission.student.id,
    submission.student.name,
    submission.student.email,
    submission.groupName,
    submission.fileName,
    submission.folderName,
    'สมชาย',
  ]) {
    assert.ok(!wire.includes(secret), `พบ "${secret}" ใน prompt`);
  }
});

test('ชื่อเฟรมและข้อความบนหน้าจอถูกกวาด ไม่ใช่แค่ฟิลด์ในฐานข้อมูล', () => {
  const { anonymized } = anonymize(submission);

  const profile = anonymized.frames.find((f) => f.id === 'frame-4')!;
  assert.ok(!profile.name.includes('สมชาย'));
  assert.ok(profile.name.includes('[ถอดออก]'));

  const menuTexts = anonymized.frames.find((f) => f.id === 'frame-2')!.texts;
  assert.ok(menuTexts.every((t) => !t.content.includes('65010123')));
});

test('รหัสแทนตัวต้องสุ่ม ห้าม derive จากรหัสนักศึกษาแม้ผ่าน hash', () => {
  const a = anonymize(submission).anonymized.alias;
  const b = anonymize(submission).anonymized.alias;

  // input เดิม แต่ผลต่าง → แปลว่าไม่ได้มาจากฟังก์ชันคงที่
  assert.notEqual(a, b, 'alias ซ้ำกัน แปลว่าเชื่อมโยงข้ามครั้งได้ = ระบุตัวตนโดยพฤตินัย');
  assert.ok(!a.includes(submission.student.id));

  // และต้องไม่ใช่ hash ของรหัสนักศึกษาแบบตรง ๆ ด้วย
  const h = createHash('sha256').update(submission.student.id).digest('hex');
  assert.ok(!h.startsWith(a.replace('S-', '')));
});

test('assertClean ต้องโยน error ไม่ใช่คืนค่าเงียบ ๆ', () => {
  assert.throws(
    () => assertClean('ผลงานของ 65010123 ดูดี', ['65010123']),
    /หลุดออกมา/,
    'ถ้ามันคืน false เฉย ๆ สักวันจะไม่มีใครเช็ก',
  );

  // ไม่มีอะไรหลุด → ต้องผ่านเงียบ ๆ
  assert.doesNotThrow(() => assertClean('ผลงานชิ้นนี้ดูดี', ['65010123']));
});

test('ข้อจำกัดที่ต้องยอมรับ: ชื่อที่อยู่ในพิกเซลถอดไม่ได้', () => {
  const { anonymized } = anonymize(submission);

  // ภาพถูกส่งต่อทั้งก้อนโดยไม่ถูกแตะ — นี่คือความจริงของระบบ ไม่ใช่บั๊ก
  assert.deepEqual(anonymized.images, submission.images);

  // ดังนั้นนโยบายพูดได้แค่ "ไม่ส่งข้อมูลระบุตัวตนที่ระบบถืออยู่"
  // พูดว่า "โมเดลไม่มีทางรู้ว่าใครทำ" ไม่ได้ — เทสต์นี้มีไว้กันไม่ให้ใครเผลอเขียนแบบนั้น
});
