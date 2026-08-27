# HWAI Grading Agent — AI ช่วยตรวจงาน UX/UI

## เริ่มต้นใช้งาน

```bash
npm install                          # ติดตั้ง dependency
GROQ_API_KEY=gsk_... npm run server  # เปิด web UI ที่ http://localhost:3000
```

ต้องการ Node 22.6+ ต้องมี **GROQ_API_KEY** (จาก [console.groq.com](https://console.groq.com))

## วิธีใช้งาน

1. เปิดเบราว์เซอร์ไปที่ `http://localhost:3000`
2. อัปโหลดไฟล์ **Rubric (.csv)** — ดูรูปแบบด้านล่าง
3. อัปโหลดไฟล์ **PDF** ของนักศึกษา
4. กด **เริ่มให้คะแนน**
5. ดูผลคะแนนรายเกณฑ์ + บันทึกสืบย้อน

## รูปแบบ CSV Rubric

```csv
criterion_id,criterion_name,weight,max,layer,rule_kind,rule_param,cloIds,level_score,level_label,level_anchor
C1,ความอ่านออกของตัวอักษร,0.2,3,rule,contrast,4.5,CLO2,0,ไม่ผ่าน,มีข้อความคอนทราสต์ต่ำเกินครึ่ง
C1,ความอ่านออกของตัวอักษร,0.2,3,rule,contrast,4.5,CLO2,1,พอใช้,มีข้อความคอนทราสต์ต่ำบางจุด
C1,ความอ่านออกของตัวอักษร,0.2,3,rule,contrast,4.5,CLO2,2,ดี,เกือบทุกข้อความผ่านเกณฑ์
C1,ความอ่านออกของตัวอักษร,0.2,3,rule,contrast,4.5,CLO2,3,ดีมาก,ทุกข้อความผ่านเกณฑ์คอนทราสต์ 4.5:1
C2,ความครบถ้วนของหน้าจอ,0.2,3,rule,required-frames,Home;Menu;Cart;Checkout,CLO1,0,ไม่ผ่าน,ขาดหน้าจอเกินครึ่ง
C2,ความครบถ้วนของหน้าจอ,0.2,3,rule,required-frames,Home;Menu;Cart;Checkout,CLO1,3,ดีมาก,ครบทุกหน้าจอ
C3,ลำดับสายตา,0.3,3,llm,,,CLO2;CLO3,0,ไม่ผ่าน,ไม่มีลำดับความสำคัญ
C3,ลำดับสายตา,0.3,3,llm,,,CLO2;CLO3,3,ดีมาก,ทุกหน้ามีจุดนำสายตาเดียว
C4,ความเหมาะสมของ flow,0.3,3,llm,,,CLO3,0,ไม่ผ่าน,ทำงานหลักให้จบไม่ได้
C4,ความเหมาะสมของ flow,0.3,3,llm,,,CLO3,3,ดีมาก,flow สั้นที่สุดเท่าที่งานต้องการ
```

- `rule_kind`: `contrast` / `min-font-size` / `required-frames`
- `rule_param`: ค่าสำหรับ rule (ตัวเลข หรือชื่อเฟรมคั่นด้วย `;`)
- `layer`: `rule` = ชั้นกฎ (วัดตรง ๆ), `llm` = ให้โมเดลตัดสิน
- น้ำหนักรวมต้องเท่ากับ 1.0

---

## ท่อทั้งเส้น

```
grade(submission, rubric, judge)
  0. ยามนโยบาย   assertMayLeaveFaculty()   ← อนุญาตส่งออก Groq
  1. ถอดตัวตน     anonymize()              ← ชื่อ / รหัส / ชื่อไฟล์
  2. ชั้นกฎ        scoreByRule()            ← contrast, ครบองค์ประกอบ (ถ้ามี)
  3. ชั้น LLM      judge.score()            ← Groq API (qwen/qwen3.8-27b)
  4. รวม + สืบย้อน merge + trace[]          ← ใครให้คะแนน ด้วยอะไร เมื่อไร
     → status: 'awaiting-instructor'
```

| ไฟล์ | หน้าที่ |
|---|---|
| `src/types.ts` | ชนิดข้อมูลกลาง |
| `src/csv-rubric.ts` | **แปลง CSV → Rubric object** |
| `src/pdf-reader.ts` | **แปลง PDF → Submission object** |
| `src/groq-judge.ts` | **ต่อกับ Groq API (qwen/qwen3.8-27b)** |
| `src/server.ts` | **HTTP server + Web UI** |
| `src/anonymize.ts` | ถอดตัวตน + คืน "รายการสตริงต้องห้าม" |
| `src/rules.ts` | คณิตศาสตร์ WCAG contrast + แปลงผลกฎเป็นคะแนน |
| `src/prompt.ts` | ประกอบ prompt + ด่านสุดท้ายก่อนออกจากเครื่อง |
| `src/judge.ts` | ตัวต่อ LLM (Mock, vLLM, Anthropic) + ตัวตรวจคำตอบ |
| `src/grade.ts` | ตัวเดินท่อ ฟังก์ชันเดียวที่ฝั่งเว็บเรียก |
| `src/public/index.html` | **Web UI สำหรับอัปโหลดไฟล์และดูผล** |

---

## ตัวต่อ LLM

| ตัวต่อ | ใช้เมื่อไร | ต่อกับอะไร |
|---|---|---|
| `MockJudge` | พัฒนา / เขียนเทสต์ | ไม่ต่อกับอะไร ให้ผลเดิมทุกครั้ง |
| `VllmJudge` | เครื่อง GPU ของคณะ | vLLM endpoint |
| `AnthropicJudge` | เปรียบเทียบระดับบนสุด | Anthropic API |
| **`GroqJudge`** | **ตัวที่ใช้จริงตอนนี้** | **Groq API (qwen/qwen3.8-27b)** |

`GroqJudge` เป็น text-only model — ไม่ส่งภาพ ใช้ข้อความล้วนในการให้คะแนน

---

## นโยบายที่ถูกบังคับด้วยโค้ด

| กฎ | บังคับที่ไหน | เทสต์ |
|---|---|---|
| ข้อมูลระบุตัวตนห้ามหลุดเข้า prompt | `assertClean()` ใน `buildPrompt()` | `anonymize.test.ts` |
| LLM ให้คะแนนนอกระดับที่ rubric นิยามไม่ได้ | `parseAndValidate()` | `grade.test.ts` |

---

## ทดสอบ

```bash
npm test    # 19 เทสต์ — รันได้โดยไม่ต้องมี API key
```
