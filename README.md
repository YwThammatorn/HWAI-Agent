# HWAI Grading Agent — AI ช่วยตรวจงาน UX/UI

## commit version remark (from dev)

- all rubric criterions have only 'llm' in layer column
- all test files is blank except evaluation.test.ts (ai generated)
- evaluation module still not test with group submissions
- evaluation metrics still not checked by manual calculate
- figma api calls only GET /files (GET /image commented)
- figma url link have to include node id (url from copy link not have)
- **figma url link grade still not test** (error 429 : exceed limit)

## เริ่มต้นใช้งาน

```bash
npm install                          # ติดตั้ง dependency
GROQ_API_KEY=gsk_... npm run server  # เปิด web UI ที่ http://localhost:3000
```

ต้องการ Node 22.6+ ต้องมี:
- **GROQ_API_KEY** (จาก [console.groq.com](https://console.groq.com))
- **FIGMA_API_KEY** (จาก Figma > Settings > Personal Access Tokens) — ใช้เฉพาะการตรวจจาก Figma Link

## วิธีใช้งาน

1. เปิดเบราว์เซอร์ไปที่ `http://localhost:3000`
2. อัปโหลดไฟล์ **Rubric (.csv)** — ดูรูปแบบด้านล่าง
3. เพิ่มชิ้นงานด้วยวิธีใดวิธีหนึ่ง:
   - **อัปโหลดไฟล์** — PDF หรือ .jpg / .png
   - **Figma Link** — วาง URL ของไฟล์ Figma ที่เปิดเป็น public (ดูรายละเอียดด้านล่าง)
4. กด **เริ่มให้คะแนน**
5. ดูผลคะแนนรายเกณฑ์ + บันทึกสืบย้อน
6. (ถ้ามี) อัปdıklarını **Ground Truth (.csv)** แล้วกด **เทียบกับ Ground Truth**
7. ดูผล evaluation (QWK, Agreement, Bias) + Export CSV

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

## รูปแบบ CSV Ground Truth

ใช้สำหรับเทียบคะแนน AI กับคะแนนอาจารย์ — รูปแบบเดียวกับ rubric

### แบบที่ 1: Long Format (แนะนำ)

```csv
submission_id,criterion_id,score,reason
S001,C1,3,ข้อมูลครบถ้วน รูปภาพเหมาะสม
S001,C2,2,ข้อมูลบางส่วน
S002,C1,4,ดีมาก ข้อมูลครบทุกส่วน
S002,C2,3,ดี แต่ยังไม่ลึกซึ้ง
```

### แบบที่ 2: Wide Format

```csv
submission_id,C1_score,C1_reason,C2_score,C2_reason
S001,3,ข้อมูลครบ,2,บางส่วน
S002,4,ดีมาก,3,ดี
```

### คอลัมน์ที่รองรับ

| คอลัมน์ | ชื่อที่รองรับ | คำอธิบาย |
|---------|--------------|----------|
| **submission_id** | `submission_id`, `student_id`, `file_name`, `รหัสชิ้นงาน`, `รหัสนักศึกษา`, `ชื่อไฟล์` | รหัสชิ้นงาน (ต้องตรงกับที่กรอกใน UI) |
| **criterion_id** | `criterion_id`, `criterion`, `รหัสเกณฑ์`, `เกณฑ์` | รหัสเกณฑ์ (ต้องตรงกับ rubric) |
| **score** | `score`, `grade`, `points`, `คะแนน` | คะแนนจากอาจารย์ (ตัวเลข) |
| **reason** | `reason`, `comment`, `feedback`, `เหตุผล`, `คำอธิบาย` | เหตุผลประกอบคะแนน |

> **หมายเหตุ:** คอลัมน์ student_name, group_name เป็น optional

## ตรวจงานจาก Figma Link

ระบบรองรับการดึงข้อมูลจากไฟล์ Figma สาธารณะผ่าน Figma REST API โดยไม่ต้องดาวน์โหลดไฟล์

### ตั้งค่า

1. ไปที่ Figma > Settings > **Personal Access Tokens**
2. สร้าง token ใหม่ (ชื่ออะไรก็ได้ เช่น `hwai-grading`)
3. คัดลอก token มาใส่ใน `.env`:

```
FIGMA_API_KEY=figd_xxxxxxxxxxxxxxxxxxxxxxxx
```

4. ในไฟล์ Figma ต้องเปิด link sharing:
   - คลิก **Share** > เปลี่ยนเป็น **"Anyone with the link"** > **"can view"**

### วิธีใช้

1. คัดลอก URL ของ Figma file ที่ต้องการตรวจ เช่น:
   ```
   https://www.figma.com/design/RaCHy2Vwuwrr5EalxXcRbo/HWAI_test_66010123?node-id=0-1
   ```
2. ในหน้าเว็บ กดปุ่ม **"🔗 Figma Link"** ที่ชิ้นงาน
3. วาง URL ลงในช่อง input
4. กด **เริ่มให้คะแนน** ได้เลย

### สิ่งที่ระบบดึงจาก Figma API

| ข้อมูล | วิธีดึง |
|--------|--------|
| **Node tree** (ชื่อเฟรม, ตำแหน่ง, ขนาด) | `GET /v1/files/:key?ids=:nodeId` |
| **TEXT nodes** (ข้อความ, font size, สี) | recursive traversal จาก node tree |
| **รูปภาพ** ของแต่ละ frame | `GET /v1/images/:key?ids=:nodeIds&format=png&scale=2` |

> **หมายเหตุ:**
> - URL ต้องมี `?node-id=` กำกับ เพื่อระบุว่าจะตรวจส่วนไหนของไฟล์
> - ถ้าไม่ระบุ node-id จะเกิด error
> - ระบบรองรับ URL แบบ `figma.com/design/`, `figma.com/file/`, และ `figma.com/proto/`

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
| `src/tool/figma-api.ts` | **ดึงข้อมูลจาก Figma API + แปลงเป็น Submission** |
| `src/groq-judge.ts` | **ต่อกับ Groq API (qwen/qwen3.8-27b)** |
| `src/server.ts` | **HTTP server + Web UI** |
| `src/anonymize.ts` | ถอดตัวตน + คืน "รายการสตริงต้องห้าม" |
| `src/rules.ts` | คณิตศาสตร์ WCAG contrast + แปลงผลกฎเป็นคะแนน |
| `src/prompt.ts` | ประกอบ prompt + ด่านสุดท้ายก่อนออกจากเครื่อง |
| `src/judge.ts` | ตัวต่อ LLM (Mock, vLLM, Anthropic) + ตัวตรวจคำตอบ |
| `src/grade.ts` | ตัวเดินท่อ ฟังก์ชันเดียวที่ฝั่งเว็บเรียก |
| `src/ground-truth.ts` | **แปลง Excel → GroundTruthData** |
| `src/evaluation.ts` | **คำนวณ QWK, Agreement, Bias, MAE + Export CSV** |
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
npm test    # 10 เทสต์ — รันได้โดยไม่ต้องมี API key
```

## เมตริก Evaluation (ตามเอกสาร 03-ai-rl-research §2.3-2.5)

| เมตริก | คำอธิบาย | เกณฑ์ความสำเร็จ |
|--------|----------|------------------|
| **Exact Agreement** | คะแนนตรงกันพอดี | ≥ 70% |
| **Adjacent Agreement** | ห่างไม่เกิน 1 ระดับ | ≥ 90% |
| **QWK** | Quadratic Weighted Kappa | CI lower ≥ 0.60 |
| **Bias** | Mean Signed Error (บอกทิศ) | |Bias| < 0.25 ระดับ |
| **MAE** | Mean Absolute Error | ใช้ประกอบ |
| **ICC(2,1)** | Intraclass Correlation | เทียบกับวรรณกรรม |
