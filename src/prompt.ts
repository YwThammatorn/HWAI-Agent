import { assertClean } from './anonymize.ts';
import type { AnonymizedSubmission, Criterion, Rubric } from './types.ts';

/**
 * ตัวสร้าง prompt — จุดเดียวในระบบที่ข้อมูลเดินทางออกไปหาโมเดล
 *
 * ทุกอย่างที่ต้องบังคับก่อนข้อมูลออกจากเครื่อง ต้องบังคับที่นี่
 * ไม่ใช่ที่หน้าจอ ไม่ใช่ที่ตัวเรียก เพราะที่นี่คือคอขวดที่เลี่ยงไม่ได้
 */

/**
 * รูปร่างกลางของ prompt ที่ยังไม่ผูกกับผู้ให้บริการรายไหน
 * ตัว adapter แต่ละตัวใน judge.ts จะแปลงก้อนนี้เป็นรูปแบบของ API ตัวเอง
 *
 * ที่ต้องมีชั้นกลางนี้ เพราะ vLLM กับ Anthropic รับ "ภาพ" คนละรูปแบบกัน
 * ถ้าเขียนตรงเข้า API ตัวใดตัวหนึ่ง วันที่ย้ายจะต้องรื้อทั้งท่อ
 */
export type GradingPrompt = {
  system: string;
  /** ข้อความหลักที่ส่งไปพร้อมภาพ */
  instruction: string;
  images: { mediaType: string; dataBase64: string }[];
  /** สัญญาว่าคำตอบต้องหน้าตาแบบไหน — ใช้บังคับ JSON ทั้งฝั่งส่งและฝั่งรับ */
  schema: object;
  /** เกณฑ์ที่รอบนี้ให้โมเดลตัดสิน (เฉพาะ layer === 'llm') */
  criteria: Criterion[];
};

export function buildPrompt(
  rubric: Rubric,
  sub: AnonymizedSubmission,
  forbidden: string[],
): GradingPrompt {
  const llmCriteria = rubric.criteria.filter((c) => c.layer === 'llm');

  const system = [
    'คุณเป็นผู้ช่วยตรวจงานออกแบบ UX/UI ในรายวิชาระดับปริญญาตรี',
    'หน้าที่ของคุณคือให้คะแนนตามเกณฑ์ที่กำหนด พร้อมเหตุผลและหลักฐานที่ชี้กลับไปที่หน้าจอได้',
    '',
    'ข้อบังคับ:',
    '- ให้คะแนนได้เฉพาะระดับที่ระบุไว้ในเกณฑ์เท่านั้น ห้ามให้คะแนนระหว่างระดับ',
    '- ทุกคะแนนต้องมีหลักฐานอย่างน้อยหนึ่งชิ้น อ้างอิงด้วย frameId ที่ให้มา',
    '- ถ้าหลักฐานในภาพไม่พอจะตัดสิน ให้ตอบ needsHuman = true แทนการเดา',
    '- ตอบเป็น JSON ตามโครงที่กำหนดเท่านั้น ห้ามมีข้อความอื่นนอก JSON',
  ].join('\n');

  const instruction = [
    `ชิ้นงาน: ${rubric.assignment}`,
    `รหัสชิ้นงาน: ${sub.alias}`,
    '',
    'หน้าจอที่ส่งมา:',
    ...sub.frames.map((f) => `  - ${f.id} — "${f.name}" (${f.bbox.w}×${f.bbox.h})`),
    '',
    'เกณฑ์ที่ต้องให้คะแนน:',
    ...llmCriteria.map(renderCriterion),
  ].join('\n');

  const prompt: GradingPrompt = {
    system,
    instruction,
    images: sub.images.map((i) => ({ mediaType: i.mediaType, dataBase64: i.dataBase64 })),
    schema: responseSchema(llmCriteria),
    criteria: llmCriteria,
  };

  // ── ด่านสุดท้าย ──
  // ตรวจข้อความทุกส่วนที่จะเดินทางออกไป ยกเว้นก้อน base64 ของภาพ
  // (ภาพเป็นพิกเซล ไม่ใช่สตริง การหาสตริงในนั้นไม่มีความหมาย — ดูข้อจำกัดใน anonymize.ts)
  assertClean(JSON.stringify({ system, instruction, schema: prompt.schema }), forbidden);

  return prompt;
}

function renderCriterion(c: Criterion): string {
  const levels = [...c.levels]
    .sort((a, b) => b.score - a.score)
    .map((l) => `      ${l.score} = ${l.label} — ${l.anchor}`)
    .join('\n');
  return `  [${c.id}] ${c.name} (เต็ม ${c.max})\n${levels}`;
}

/**
 * โครงคำตอบ — เขียนเป็น JSON Schema เพราะทั้ง vLLM และ Anthropic
 * รับ schema ไปบังคับการถอดรหัสได้ ทำให้ไม่ต้องมานั่ง parse ข้อความมั่ว ๆ
 */
function responseSchema(criteria: Criterion[]): object {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['scores'],
    properties: {
      scores: {
        type: 'array',
        minItems: criteria.length,
        maxItems: criteria.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['criterionId', 'score', 'reason', 'evidence', 'needsHuman'],
          properties: {
            criterionId: { type: 'string', enum: criteria.map((c) => c.id) },
            score: { type: 'number' },
            reason: { type: 'string', minLength: 10 },
            evidence: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['frameId', 'note'],
                properties: { frameId: { type: 'string' }, note: { type: 'string' } },
              },
            },
            needsHuman: { type: 'boolean' },
          },
        },
      },
    },
  };
}

/**
 * ทำไมผลของชั้นกฎไม่ถูกใส่เข้ามาใน prompt
 *
 * ใส่แล้วจะสะดวกกว่า — โมเดลจะได้รู้ว่าคอนทราสต์ตกไปกี่จุด
 * แต่มันคือการ anchor: โมเดลที่เห็นว่า "ชั้นกฎบอกว่าแย่" มีแนวโน้มให้คะแนนเกณฑ์อื่นต่ำตาม
 * แล้วเราจะแยกไม่ออกว่าคะแนนที่ได้มาจากการดูงาน หรือมาจากการเห็นคะแนนอื่นก่อน
 * ซึ่งทำให้ตัวเลขในบทที่ 4 ตอบคำถามคนละข้อกับที่ตั้งใจถาม
 */
