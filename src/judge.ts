import { createHash } from 'node:crypto';
import type { GradingPrompt } from './prompt.ts';
import type { CriterionScore } from './types.ts';

/**
 * ═══════════════════════════════════════════════════════════════════
 *  ชั้นที่ 3 — จุดที่ต่อกับ LLM
 *  ไฟล์นี้คือคำตอบของคำถาม "แล้วมันเชื่อมกับ LLM ยังไง"
 * ═══════════════════════════════════════════════════════════════════
 *
 * คำตอบสั้น ๆ: **มันคือ HTTP POST ธรรมดาหนึ่งครั้ง**
 *
 * เว็บของเราไม่ได้โหลดโมเดล ไม่ได้ import ไลบรารี AI ไม่แตะ CUDA เลย
 * โมเดลถูกโหลดโดยโปรแกรมชื่อ vLLM ที่รันแยกอยู่บนเครื่อง GPU
 * และ vLLM เปิดพอร์ต HTTP ที่พูดภาษาเดียวกับ OpenAI API
 * หน้าที่ของโค้ดเราจึงเหลือแค่ "ประกอบ JSON แล้วยิงไป แล้วอ่าน JSON กลับมา"
 *
 *   เบราว์เซอร์
 *       │  HTTPS
 *       ▼
 *   VM ของคณะ  (Next.js + PostgreSQL + worker)      ← โค้ดในโปรเจกต์นี้อยู่ตรงนี้
 *       │  HTTP ภายใน  POST /v1/chat/completions
 *       ▼
 *   เครื่อง GPU (vLLM + โมเดล VLM บน RTX 5090)      ← ไม่มีโค้ดของเราอยู่เลย
 *
 * สองเครื่องนี้คุยกันด้วยข้อความล้วน ๆ ไม่มีอะไรพิเศษ
 * ถ้าเปลี่ยนใจไปใช้ API ข้างนอก ก็เปลี่ยนแค่ URL กับรูปร่าง JSON — ท่อที่เหลือเหมือนเดิม
 */

export type JudgeOutput = {
  scores: (CriterionScore & { needsHuman: boolean })[];
  /** ข้อมูลดิบไว้ debug และไว้เขียนบทที่ 4 */
  meta: { model: string; latencyMs: number; raw?: string };
};

export interface Judge {
  readonly name: string;
  score(prompt: GradingPrompt): Promise<JudgeOutput>;
}

// ═════════════════════════ 1. Mock — ใช้พัฒนาและเทสต์ ═════════════════════════

/**
 * ตัวปลอมที่ให้ผลเหมือนเดิมทุกครั้งเมื่อ input เหมือนเดิม
 *
 * มีไว้เพื่อให้ทั้งท่อรันได้บนโน้ตบุ๊กที่ไม่มี GPU และให้เทสต์ไม่ต้องพึ่งเน็ต
 * **ห้ามเอาตัวเลขจากตัวนี้ไปเขียนในรายงานเด็ดขาด** มันไม่ได้ดูภาพด้วยซ้ำ
 */
export class MockJudge implements Judge {
  readonly name = 'mock';

  async score(prompt: GradingPrompt): Promise<JudgeOutput> {
    const started = Date.now();
    const scores = prompt.criteria.map((c) => {
      // สุ่มแบบกำหนดได้ (deterministic) จาก id ของเกณฑ์ + จำนวนเฟรม
      const seed = createHash('sha256')
        .update(c.id + prompt.instruction.length)
        .digest()[0];
      const levels = [...c.levels].sort((a, b) => a.score - b.score);
      const pick = levels[seed % levels.length];
      return {
        criterionId: c.id,
        score: pick.score,
        reason: `(mock) เลือกระดับ "${pick.label}" — ตัวนี้ไม่ได้ดูภาพจริง`,
        evidence: [{ frameId: 'frame-1', note: '(mock) ไม่ใช่หลักฐานจริง' }],
        source: 'llm' as const,
        producedBy: 'mock',
        needsHuman: false,
      };
    });
    return { scores, meta: { model: 'mock', latencyMs: Date.now() - started } };
  }
}

// ═════════════════ 2. vLLM บนเครื่อง GPU ของคณะ — ตัวที่ใช้จริง ═════════════════

/**
 * ต่อกับ vLLM ผ่าน endpoint ที่เข้ากันได้กับ OpenAI
 *
 * ฝั่ง GPU สั่งครั้งเดียวจบ:
 *   vllm serve Qwen/Qwen2.5-VL-32B-Instruct \
 *       --port 8000 --max-model-len 16384 --quantization awq
 *
 * แล้วฝั่งเราก็ยิงมาที่ http://<ip เครื่อง GPU>:8000/v1/chat/completions
 * ไม่ต้องมีคีย์ ไม่ต้องออกอินเทอร์เน็ต เพราะเป็นเครือข่ายภายในคณะ
 */
export class VllmJudge implements Judge {
  readonly name: string;
  readonly #baseUrl: string;
  readonly #model: string;
  readonly #timeoutMs: number;

  constructor(baseUrl: string, model: string, timeoutMs = 120_000) {
    this.#baseUrl = baseUrl;
    this.#model = model;
    this.#timeoutMs = timeoutMs;
    this.name = `vllm:${model}`;
  }

  /**
   * ประกอบ body ที่จะส่ง — แยกออกมาเป็นเมธอดสาธารณะเพื่อให้ demo พิมพ์ดูได้
   * โดยไม่ต้องมีเครื่อง GPU จริง (ดู demo.ts)
   */
  buildRequestBody(prompt: GradingPrompt): object {
    return {
      model: this.#model,
      messages: [
        { role: 'system', content: prompt.system },
        {
          role: 'user',
          // เนื้อความของ user เป็น "อาร์เรย์ของบล็อก" ไม่ใช่สตริง
          // เพราะต้องแนบภาพไปด้วย — นี่คือจุดที่ต่างจากการเรียก LLM ข้อความล้วน
          content: [
            { type: 'text', text: prompt.instruction },
            ...prompt.images.map((img) => ({
              type: 'image_url',
              // ภาพเดินทางไปเป็น data URI ไม่ต้องอัปโหลดไฟล์ก่อน
              image_url: { url: `data:${img.mediaType};base64,${img.dataBase64}` },
            })),
          ],
        },
      ],
      // บังคับให้ตอบเป็น JSON ตามโครง — vLLM ใช้ guided decoding ทำให้ผิดโครงไม่ได้เลย
      // ไม่ใช่แค่ "ขอร้องใน prompt" ซึ่งพังเป็นครั้งคราวเสมอ
      response_format: { type: 'json_schema', json_schema: { name: 'grading', schema: prompt.schema, strict: true } },
      temperature: 0, // ต้องการผลซ้ำได้ ไม่ต้องการความสร้างสรรค์
      max_tokens: 2048,
    };
  }

  async score(prompt: GradingPrompt): Promise<JudgeOutput> {
    const started = Date.now();
    const res = await fetch(`${this.#baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(this.buildRequestBody(prompt)),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`vLLM ตอบ ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as { choices: { message: { content: string } }[] };
    const raw = json.choices[0].message.content;
    return {
      scores: parseAndValidate(raw, prompt, this.name),
      meta: { model: this.#model, latencyMs: Date.now() - started, raw },
    };
  }
}

// ═══════════ 3. API ภายนอก — จุดเทียบระดับบนสุด ไม่ใช่ตัวตรวจประจำวัน ═══════════

/**
 * ต่อกับ Anthropic Messages API
 *
 * ตั๋ว 18 ตัดสินว่า **งานนักศึกษาไม่ออกนอกคณะเด็ดขาด ไม่มีเงื่อนไข**
 * ตัวนี้จึงมีไว้ใช้กับ "ชุดตัวอย่างแยกที่ขออนุญาตรายชิ้น" เท่านั้น
 * และนโยบายนั้นถูกบังคับด้วยโค้ดข้างล่าง ไม่ใช่ด้วยความจำของคนเรียก
 */
export class AnthropicJudge implements Judge {
  readonly name: string;
  readonly #apiKey: string;
  readonly #model: string;

  constructor(apiKey: string, model = 'claude-opus-5') {
    this.#apiKey = apiKey;
    this.#model = model;
    this.name = `anthropic:${model}`;
  }

  buildRequestBody(prompt: GradingPrompt): object {
    return {
      model: this.#model,
      max_tokens: 2048,
      system: prompt.system,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt.instruction },
            // รูปแบบภาพต่างจาก vLLM ตรงนี้ — เป็นเหตุผลที่ต้องมี GradingPrompt เป็นชั้นกลาง
            ...prompt.images.map((img) => ({
              type: 'image',
              source: { type: 'base64', media_type: img.mediaType, data: img.dataBase64 },
            })),
          ],
        },
      ],
      // บังคับโครงคำตอบด้วย tool ที่มี input_schema แล้วอ่านจาก tool_use
      tools: [{ name: 'submit_scores', description: 'ส่งคะแนนตามเกณฑ์', input_schema: prompt.schema }],
      tool_choice: { type: 'tool', name: 'submit_scores' },
    };
  }

  async score(prompt: GradingPrompt): Promise<JudgeOutput> {
    const started = Date.now();
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.#apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(this.buildRequestBody(prompt)),
    });

    if (!res.ok) throw new Error(`Anthropic ตอบ ${res.status}: ${await res.text()}`);

    const json = (await res.json()) as { content: { type: string; input?: unknown }[] };
    const toolUse = json.content.find((c) => c.type === 'tool_use');
    if (!toolUse) throw new Error('ไม่พบ tool_use ในคำตอบ');
    const raw = JSON.stringify(toolUse.input);
    return {
      scores: parseAndValidate(raw, prompt, this.name),
      meta: { model: this.#model, latencyMs: Date.now() - started, raw },
    };
  }
}

/**
 * ยามที่บังคับนโยบาย "ไม่ออกนอกคณะ" ให้เป็นจริงในระดับโค้ด
 * ต้องเรียกก่อนใช้ judge ที่ออกอินเทอร์เน็ต
 */
export function assertMayLeaveFaculty(externalUseConsent: boolean | undefined, judge: Judge): void {
  const goesOutside = !judge.name.startsWith('vllm') && judge.name !== 'mock';
  if (goesOutside && externalUseConsent !== true) {
    throw new Error(
      `ปฏิเสธการส่งออก: ${judge.name} ออกนอกคณะ แต่ชิ้นงานนี้ไม่มีความยินยอมรายชิ้น ` +
        `(ดูเอกสาร 01 §4.4.6)`,
    );
  }
}

// ═══════════════════════ ตัวตรวจคำตอบที่ได้กลับมา ═══════════════════════

/**
 * โมเดลตอบผิดโครงได้เสมอ แม้จะบังคับ schema ไว้แล้ว
 * ท่อที่เชื่อคำตอบโดยไม่ตรวจ จะพังตอนมีงานส่งพร้อมกัน 60 ชิ้น ไม่ใช่ตอนเทสต์
 */
export function parseAndValidate(
  raw: string,
  prompt: GradingPrompt,
  producedBy: string,
): (CriterionScore & { needsHuman: boolean })[] {
  let parsed: { scores?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`โมเดลตอบไม่ใช่ JSON: ${raw.slice(0, 200)}`);
  }

  if (!Array.isArray(parsed.scores)) throw new Error('คำตอบไม่มีฟิลด์ scores ที่เป็นอาร์เรย์');

  const byId = new Map(prompt.criteria.map((c) => [c.id, c]));
  const seen = new Set<string>();

  const out = (parsed.scores as Record<string, unknown>[]).map((s) => {
    const criterion = byId.get(String(s.criterionId));
    if (!criterion) throw new Error(`ไม่รู้จักเกณฑ์ "${s.criterionId}"`);
    if (seen.has(criterion.id)) throw new Error(`เกณฑ์ ${criterion.id} ถูกให้คะแนนซ้ำ`);
    seen.add(criterion.id);

    // คะแนนต้องเป็นระดับที่ rubric นิยามไว้ ไม่ใช่เลขอะไรก็ได้
    const allowed = criterion.levels.map((l) => l.score);
    const score = Number(s.score);
    if (!allowed.includes(score)) {
      throw new Error(`เกณฑ์ ${criterion.id} ให้คะแนน ${score} ซึ่งไม่ใช่ระดับที่นิยามไว้ (${allowed})`);
    }

    const evidence = Array.isArray(s.evidence) ? (s.evidence as { frameId: string; note: string }[]) : [];
    if (evidence.length === 0) throw new Error(`เกณฑ์ ${criterion.id} ไม่มีหลักฐาน`);

    return {
      criterionId: criterion.id,
      score,
      reason: String(s.reason ?? ''),
      evidence,
      source: 'llm' as const,
      producedBy,
      needsHuman: Boolean(s.needsHuman),
    };
  });

  const missing = prompt.criteria.filter((c) => !seen.has(c.id));
  if (missing.length > 0) {
    throw new Error(`ขาดคะแนนของเกณฑ์: ${missing.map((c) => c.id).join(', ')}`);
  }

  return out;
}
