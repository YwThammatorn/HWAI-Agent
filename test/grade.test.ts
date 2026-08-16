import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rubric, submission } from '../fixtures/rubric.ts';
import { grade } from '../src/grade.ts';
import { AnthropicJudge, MockJudge, parseAndValidate, type Judge, type JudgeOutput } from '../src/judge.ts';
import type { GradingPrompt } from '../src/prompt.ts';
import { scoreByRule } from '../src/rules.ts';

/** ตัวตัดสินที่ "ประพฤติผิด" — ใช้ทดสอบว่าท่อกันตัวเองได้จริงไหม */
class RogueJudge implements Judge {
  readonly name = 'vllm:rogue'; // ตั้งชื่อขึ้นต้น vllm เพื่อให้ผ่านยามนโยบายมาถึงจุดที่จะทดสอบ

  async score(prompt: GradingPrompt): Promise<JudgeOutput> {
    const scores = [
      // แอบให้คะแนนเกณฑ์ของชั้นกฎ ทั้งที่ไม่ได้ถูกถาม
      { criterionId: 'C1', score: 3, reason: 'ฉันว่าดีมาก', evidence: [{ frameId: 'frame-1', note: 'x' }], source: 'llm' as const, producedBy: this.name, needsHuman: false },
      { criterionId: 'C2', score: 3, reason: 'ฉันว่าครบแล้ว', evidence: [{ frameId: 'frame-1', note: 'x' }], source: 'llm' as const, producedBy: this.name, needsHuman: false },
      ...prompt.criteria.map((c) => ({
        criterionId: c.id,
        score: 2,
        reason: 'ตอบตามที่ถูกถาม',
        evidence: [{ frameId: 'frame-1', note: 'x' }],
        source: 'llm' as const,
        producedBy: this.name,
        needsHuman: false,
      })),
    ];
    return { scores, meta: { model: 'rogue', latencyMs: 0 } };
  }
}

test('LLM เขียนทับคะแนนของชั้นกฎไม่ได้ แม้จะพยายาม', async () => {
  const record = await grade(submission, rubric, new RogueJudge());

  const c1 = record.scores.find((s) => s.criterionId === 'C1')!;
  const c2 = record.scores.find((s) => s.criterionId === 'C2')!;

  assert.equal(c1.source, 'rule');
  assert.equal(c2.source, 'rule');
  assert.equal(c1.score, scoreByRule(rubric.criteria[0], submission.figma).score);
  assert.equal(c2.score, 2); // ขาดหน้า Checkout จริง ไม่ใช่ 3 ตามที่โมเดลอ้าง
  assert.ok(c1.producedBy.startsWith('rule:'));
});

test('เกณฑ์ที่ให้ LLM ตัดสิน ต้องติดป้ายว่ามาจาก LLM ตัวไหน', async () => {
  const record = await grade(submission, rubric, new MockJudge());
  const c3 = record.scores.find((s) => s.criterionId === 'C3')!;

  assert.equal(c3.source, 'llm');
  assert.equal(c3.producedBy, 'mock');
});

test('ผลตรวจออกมาเป็น "รอการยืนยันของอาจารย์" เสมอ ไม่มีทางลัด', async () => {
  const record = await grade(submission, rubric, new MockJudge());
  assert.equal(record.status, 'awaiting-instructor');

  // และต้องรู้ว่าใช้ rubric เวอร์ชันไหน ไม่งั้นเทียบข้ามรอบไม่ได้
  assert.equal(record.rubricVersion, rubric.version);
  assert.ok(record.trace.length >= 5);
  assert.ok(record.trace.some((t) => t.step === 'anonymize'));
  assert.ok(record.trace.some((t) => t.step === 'llm'));
});

test('คะแนนออกมาครบทุกเกณฑ์ เรียงตาม rubric ไม่ใช่ตามที่โมเดลตอบ', async () => {
  const record = await grade(submission, rubric, new MockJudge());
  assert.deepEqual(
    record.scores.map((s) => s.criterionId),
    rubric.criteria.map((c) => c.id),
  );
  assert.ok(record.weightedTotal >= 0 && record.weightedTotal <= 1);
});

test('API ภายนอกถูกปฏิเสธเมื่อไม่มีความยินยอมรายชิ้น', async () => {
  assert.equal(submission.externalUseConsent, false);

  await assert.rejects(
    () => grade(submission, rubric, new AnthropicJudge('sk-ant-ไม่ได้ใช้จริง')),
    /ปฏิเสธการส่งออก/,
    'ถ้าเทสต์นี้แดง แปลว่านโยบาย "งานนักศึกษาไม่ออกนอกคณะ" เป็นแค่คำพูดในเอกสาร',
  );

  // ยินยอมแล้วถึงจะผ่านยามได้ (ในเทสต์นี้จะไปพังตอนยิงเน็ตจริง ซึ่งคนละเรื่องกัน)
  const consented = { ...submission, externalUseConsent: true };
  await assert.rejects(
    () => grade(consented, rubric, new AnthropicJudge('sk-ant-ไม่ได้ใช้จริง')),
    (err: Error) => !/ปฏิเสธการส่งออก/.test(err.message),
  );
});

// ─────────── ตัวตรวจคำตอบจากโมเดล ───────────

const fakePrompt = (): GradingPrompt => ({
  system: '',
  instruction: '',
  images: [],
  schema: {},
  criteria: rubric.criteria.filter((c) => c.layer === 'llm'),
});

test('คำตอบที่ให้คะแนนนอกระดับที่ rubric นิยาม ต้องถูกปฏิเสธ', () => {
  const raw = JSON.stringify({
    scores: [
      { criterionId: 'C3', score: 2.5, reason: 'ก้ำกึ่ง', evidence: [{ frameId: 'frame-1', note: 'x' }] },
      { criterionId: 'C4', score: 2, reason: 'ok', evidence: [{ frameId: 'frame-1', note: 'x' }] },
    ],
  });
  assert.throws(() => parseAndValidate(raw, fakePrompt(), 'test'), /ไม่ใช่ระดับที่นิยามไว้/);
});

test('คำตอบที่ขาดเกณฑ์ หรือให้คะแนนโดยไม่มีหลักฐาน ต้องถูกปฏิเสธ', () => {
  const missing = JSON.stringify({
    scores: [{ criterionId: 'C3', score: 2, reason: 'ok', evidence: [{ frameId: 'frame-1', note: 'x' }] }],
  });
  assert.throws(() => parseAndValidate(missing, fakePrompt(), 'test'), /ขาดคะแนนของเกณฑ์/);

  const noEvidence = JSON.stringify({
    scores: [
      { criterionId: 'C3', score: 2, reason: 'ok', evidence: [] },
      { criterionId: 'C4', score: 2, reason: 'ok', evidence: [{ frameId: 'frame-1', note: 'x' }] },
    ],
  });
  assert.throws(() => parseAndValidate(noEvidence, fakePrompt(), 'test'), /ไม่มีหลักฐาน/);
});

test('โมเดลตอบไม่ใช่ JSON ต้องได้ error ที่อ่านรู้เรื่อง ไม่ใช่ crash ลึก ๆ', () => {
  assert.throws(
    () => parseAndValidate('ขอโทษครับ ผมขออธิบายก่อนว่า...', fakePrompt(), 'test'),
    /ตอบไม่ใช่ JSON/,
  );
});
