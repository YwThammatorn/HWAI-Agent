import { anonymize } from './anonymize.ts';
import { assertMayLeaveFaculty, type Judge } from './judge.ts';
import { buildPrompt } from './prompt.ts';
import { scoreByRule } from './rules.ts';
import type { CriterionScore, GradingRecord, Rubric, Submission, TraceEntry } from './types.ts';

/**
 * ตัวเดินท่อทั้งหมด — ฟังก์ชันเดียวที่ฝั่งเว็บเรียก
 *
 *   ถอดตัวตน → ชั้นกฎ → ชั้น LLM → รวมคะแนน → บันทึกสืบย้อน
 *
 * สิ่งที่ฟังก์ชันนี้ "ไม่" ทำ และตั้งใจไม่ทำ:
 *   - ไม่ประกาศคะแนนให้นักศึกษาเห็น  (status ออกมาเป็น awaiting-instructor เสมอ)
 *   - ไม่เขียนทับคะแนนของชั้นกฎด้วยผลของ LLM
 *   - ไม่ตัดสินใจแทนอาจารย์ในกรณีที่โมเดลบอกว่าหลักฐานไม่พอ
 */
export async function grade(
  submission: Submission,
  rubric: Rubric,
  judge: Judge,
): Promise<GradingRecord> {
  const trace: TraceEntry[] = [];
  const log = (step: string, detail: string) =>
    trace.push({ at: new Date().toISOString(), step, detail });

  // ── ยามนโยบาย: ตรวจก่อนแตะข้อมูลด้วยซ้ำ ──
  assertMayLeaveFaculty(submission.externalUseConsent, judge);
  log('policy', `อนุญาตให้ใช้ ${judge.name} กับชิ้นงานนี้`);

  // ── 1. ถอดตัวตน ──
  const { anonymized, forbidden } = anonymize(submission);
  log('anonymize', `แทนด้วยรหัส ${anonymized.alias} · กันสตริงต้องห้าม ${forbidden.length} รายการ`);

  // ── 2. ชั้นกฎ (ไม่ผ่านโมเดล ผลซ้ำได้ 100%) ──
  // ป้อน **ข้อมูลดิบ** ไม่ใช่ข้อมูลที่ถอดตัวตนแล้ว — ชั้นนี้คำนวณอยู่บนเครื่องคณะ
  // ไม่ส่งอะไรออกไปไหน การถอดตัวตนก่อนจึงไม่เพิ่มความปลอดภัย มีแต่ทำให้ตรวจผิด
  const ruleScores: CriterionScore[] = rubric.criteria
    .filter((c) => c.layer === 'rule')
    .map((c) => scoreByRule(c, submission.figma));
  log('rules', `ตัดสินด้วยกฎ ${ruleScores.length} เกณฑ์ (บนข้อมูลดิบ ไม่ออกนอกเครื่อง)`);

  // ── 3. ชั้น LLM ──
  const prompt = buildPrompt(rubric, anonymized, forbidden);
  log('prompt', `ประกอบ prompt · ภาพ ${prompt.images.length} รูป · เกณฑ์ ${prompt.criteria.length} ข้อ`);

  const judged = await judge.score(prompt);
  log('llm', `${judge.name} ตอบใน ${judged.meta.latencyMs} ms`);

  const needsHuman = judged.scores.filter((s) => s.needsHuman);
  if (needsHuman.length > 0) {
    log('llm', `โมเดลบอกว่าหลักฐานไม่พอ ${needsHuman.length} เกณฑ์ → ชูขึ้นให้อาจารย์ดูก่อน`);
  }

  // ── 4. รวมคะแนน ──
  // เรียงตามลำดับใน rubric ไม่ใช่ตามลำดับที่โมเดลตอบมา
  const all = [...ruleScores, ...judged.scores.map(({ needsHuman: _, ...rest }) => rest)];
  const scores = rubric.criteria.map((c) => {
    const hit = all.find((s) => s.criterionId === c.id);
    if (!hit) throw new Error(`ไม่มีคะแนนของเกณฑ์ ${c.id}`);
    return hit;
  });

  const weightedTotal = rubric.criteria.reduce((sum, c) => {
    const s = scores.find((x) => x.criterionId === c.id)!;
    return sum + (s.score / c.max) * c.weight;
  }, 0);

  log('merge', `คะแนนถ่วงน้ำหนัก ${(weightedTotal * 100).toFixed(1)} จาก 100`);
  log('status', 'รอการยืนยันของอาจารย์ — นักศึกษายังไม่เห็นคะแนนนี้');

  return {
    submissionId: submission.submissionId,
    rubricId: rubric.id,
    rubricVersion: rubric.version,
    alias: anonymized.alias,
    scores,
    weightedTotal,
    status: 'awaiting-instructor',
    trace,
  };
}
