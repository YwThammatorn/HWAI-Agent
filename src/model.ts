import type { GradingPrompt } from './prompt.ts';
import type { CriterionScore, Judge, JudgeOutput } from './judge.ts';
import { parseAndValidate } from './judge.ts';

/**
 * ต่อกับ Groq API — ใช้โมเดล qwen/qwen3.8-27b
 *
 * Groq API เข้ากันได้กับ OpenAI format:
 *   POST https://api.groq.com/openai/v1/chat/completions
 *   Header: Authorization: Bearer <API_KEY>
 *
 * โมเดล qwen3.8-27b เป็น text-only model
 * จึงไม่ส่งภาพ ใช้ข้อความล้วนในการให้คะแนน
 *
 * ต้องตั้งค่า environment variable:
 *   GROQ_API_KEY=gsk_...
 */
export class GroqJudge implements Judge {
  readonly name: string;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #timeoutMs: number;

  constructor(apiKey: string, model = 'qwen/qwen3.8-27b', timeoutMs = 120_000) {
    this.#apiKey = apiKey;
    this.#model = model;
    this.#timeoutMs = timeoutMs;
    this.name = `groq:${model}`;
  }

  /**
   * ประกอบ body ที่จะส่งไปหา Groq API
   * แยกออกมาเป็นเมธอดสาธารณะเพื่อ debug ได้
   *
   * ถ้ามีภาพใน prompt จะแนบไปด้วยในรูปแบบ OpenAI vision format
   * (data URI base64 ใน image_url block)
   */
  buildRequestBody(prompt: GradingPrompt): object {
    // ประกอบ user content — ถ้ามีภาพ ใช้อาร์เรย์บล็อก, ถ้าไม่มี ใช้สตริง
    const userContent: (object)[] = [
      { type: 'text', text: prompt.instruction },
    ];

    // แนบภาพทั้งหมดที่มี (base64 data URI)
    if (prompt.images.length > 0) {
      for (const img of prompt.images) {
        userContent.push({
          type: 'image_url',
          image_url: {
            url: `data:${img.mediaType};base64,${img.dataBase64}`,
          },
        });
      }
    }

    return {
      model: this.#model,
      messages: [
        { role: 'system', content: prompt.system },
        {
          role: 'user',
          // ถ้ามีภาพมากกว่า 0 ใช้อาร์เรย์, ถ้าไม่มีใช้สตริง
          content: prompt.images.length > 0 ? userContent : prompt.instruction,
        },
      ],
      // บังคับให้ตอบเป็น JSON
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 2048,
    };
  }

  async score(prompt: GradingPrompt): Promise<JudgeOutput> {
    const started = Date.now();
    const body = this.buildRequestBody(prompt);

    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${this.#apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.#timeoutMs),
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Groq API ตอบ ${res.status}: ${errorText}`);
    }

    const json = (await res.json()) as {
      choices: { message: { content: string } }[];
    };

    const raw = json.choices[0]?.message?.content;
    if (!raw) {
      throw new Error('Groq API ไม่มี content ในคำตอบ');
    }

    // Debug: แสดงคำตอบดิบจากโมเดล
    console.log(`  📝 Groq returned response }`);

    return {
      scores: parseAndValidate(raw, prompt, this.name),
      meta: {
        model: this.#model,
        latencyMs: Date.now() - started,
        raw,
      },
    };
  }
}
