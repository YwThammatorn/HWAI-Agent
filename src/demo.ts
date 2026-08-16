/**
 * เดินงานหนึ่งชิ้นผ่านท่อทั้งเส้น แล้วพิมพ์ให้เห็นทุกขั้น
 *
 *   node --experimental-strip-types src/demo.ts
 *
 * ขั้นที่ [4] คือคำตอบของ "เชื่อมกับ LLM ยังไง" — มันพิมพ์ JSON ก้อนจริง
 * ที่จะถูกยิงออกไป ให้เห็นว่าไม่มีอะไรมากกว่า HTTP POST หนึ่งครั้ง
 */
import { rubric, submission } from '../fixtures/rubric.ts';
import { anonymize } from './anonymize.ts';
import { grade } from './grade.ts';
import { AnthropicJudge, MockJudge, VllmJudge } from './judge.ts';
import { buildPrompt } from './prompt.ts';
import { runRules } from './rules.ts';

const line = (t = '') => console.log(t);
const rule = (title: string) => {
  line();
  line('═'.repeat(78));
  line(`  ${title}`);
  line('═'.repeat(78));
};

// ───────────────────────────────────────────────────────────────
rule('[1] ชิ้นงานดิบตามที่ระบบเก็บไว้ — มีข้อมูลระบุตัวตนครบ');

line(`  นักศึกษา   : ${submission.student.name} (${submission.student.id})`);
line(`  อีเมล      : ${submission.student.email}`);
line(`  กลุ่ม      : ${submission.groupName}`);
line(`  ชื่อไฟล์   : ${submission.fileName}`);
line(`  โฟลเดอร์   : ${submission.folderName}`);
line(`  ชื่อเฟรม   : ${submission.figma.frames.map((f) => `"${f.name}"`).join(', ')}`);
line();
line('  ↑ ทั้งหมดนี้ห้ามเดินทางไปถึงโมเดล');

// ───────────────────────────────────────────────────────────────
rule('[2] หลังถอดตัวตน');

const { anonymized, forbidden } = anonymize(submission);
line(`  รหัสแทนตัว : ${anonymized.alias}   ← สุ่มใหม่ ไม่ได้ derive จากรหัสนักศึกษา`);
line(`  สตริงต้องห้ามที่กันไว้ ${forbidden.length} รายการ`);
line();
line('  ชื่อเฟรมหลังกวาด:');
for (const f of anonymized.frames) line(`    ${f.id} → "${f.name}"`);
line();
line('  ข้อความบนหน้าจอหลังกวาด:');
for (const f of anonymized.frames) {
  for (const t of f.texts) line(`    ${f.id} → "${t.content}"`);
}

// ───────────────────────────────────────────────────────────────
rule('[3] ชั้นกฎ — คำนวณตรง ๆ ไม่ผ่านโมเดล ผลเท่าเดิมทุกครั้ง');

line('  ชั้นนี้ป้อน "ข้อมูลดิบ" ไม่ใช่ข้อมูลที่ถอดตัวตนแล้ว');
line('  เพราะมันคำนวณอยู่บนเครื่องคณะ ไม่ได้ส่งอะไรออกไปไหน');
line();

for (const c of rubric.criteria.filter((c) => c.layer === 'rule')) {
  line(`  [${c.id}] ${c.name}`);
  for (const f of runRules(submission.figma, c.rule!)) {
    line(`     ${f.pass ? '✔' : '✘'} ${f.detail}`);
  }
  line();
}

// ───────────────────────────────────────────────────────────────
rule('[4] จุดที่ต่อกับ LLM ← ตรงนี้คือคำตอบของ "เชื่อมกับโมเดลยังไง"');

const prompt = buildPrompt(rubric, anonymized, forbidden);

line('  เส้นทางของข้อมูล:');
line();
line('     เว็บ (Next.js บน VM ของคณะ)');
line('        │');
line('        │  POST http://<ip เครื่อง GPU>:8000/v1/chat/completions');
line('        │  content-type: application/json');
line('        ▼');
line('     vLLM (เครื่อง GPU RTX 5090) ← โมเดลถูกโหลดโดย vLLM ไม่ใช่โดยเว็บของเรา');
line();
line('  โค้ดเราไม่ import ไลบรารี AI ไม่แตะ CUDA ไม่โหลด weight อะไรทั้งนั้น');
line('  หน้าที่ทั้งหมดคือ "ประกอบ JSON ก้อนนี้แล้วยิงไป":');
line();

const vllm = new VllmJudge('http://10.0.0.9:8000', 'Qwen/Qwen2.5-VL-32B-Instruct');
line(redactImages(JSON.stringify(vllm.buildRequestBody(prompt), null, 2), 8));

line();
line('  ── สามจุดที่มักงง ─────────────────────────────────────────────');
line('  1. ภาพเดินทางไปยังไง — อยู่ใน messages[].content เป็นบล็อกชนิด image_url');
line('     ค่าเป็น data URI (base64) ไม่ต้องอัปโหลดไฟล์ไว้ที่ไหนก่อน');
line('  2. ทำไมมั่นใจว่าตอบเป็น JSON — response_format บังคับด้วย guided decoding');
line('     ของ vLLM ตัวโมเดลถูกจำกัดตอนถอดรหัสเลย ไม่ใช่แค่ขอร้องใน prompt');
line('  3. temperature = 0 เพราะเราต้องการผลซ้ำได้ ไม่ได้ต้องการความสร้างสรรค์');

// ───────────────────────────────────────────────────────────────
rule('[5] ถ้าเปลี่ยนไปใช้ API ข้างนอก เปลี่ยนแค่รูปร่าง JSON');

const anthropic = new AnthropicJudge('sk-ant-...');
line(redactImages(JSON.stringify(anthropic.buildRequestBody(prompt), null, 2), 8));
line();
line('  ต่างกันแค่: image_url → image.source.base64 · response_format → tools');
line('  ท่อที่เหลือทั้งเส้นไม่ต้องแก้เลย เพราะมี GradingPrompt เป็นชั้นกลางคั่นไว้');

// ───────────────────────────────────────────────────────────────
rule('[6] ยามนโยบาย — งานนักศึกษาไม่ออกนอกคณะ บังคับด้วยโค้ด');

try {
  await grade(submission, rubric, anthropic);
  line('  ✘ ไม่ควรมาถึงบรรทัดนี้');
} catch (err) {
  line(`  ✔ ถูกปฏิเสธตามที่ควรเป็น:`);
  line(`     ${(err as Error).message}`);
}

// ───────────────────────────────────────────────────────────────
rule('[7] รันทั้งท่อด้วย MockJudge (ไม่ต้องมี GPU)');

const record = await grade(submission, rubric, new MockJudge());

line('  คะแนนรายเกณฑ์:');
for (const s of record.scores) {
  const c = rubric.criteria.find((x) => x.id === s.criterionId)!;
  line(`    ${s.criterionId}  ${s.score}/${c.max}  [${s.source.padEnd(4)}]  ${c.name}`);
  line(`         เหตุผล: ${s.reason}`);
  for (const e of s.evidence) line(`         หลักฐาน: ${e.frameId} — ${e.note}`);
}
line();
line(`  คะแนนรวมถ่วงน้ำหนัก : ${(record.weightedTotal * 100).toFixed(1)} / 100`);
line(`  สถานะ                : ${record.status}  ← นักศึกษายังไม่เห็นคะแนนนี้`);
line();
line('  บันทึกสืบย้อน (ตอบ TABEE 1.7 ว่าใครตัดสินอะไร):');
for (const t of record.trace) line(`    ${t.at}  ${t.step.padEnd(9)} ${t.detail}`);

line();
line('  ⚠ ตัวเลขจาก MockJudge ห้ามเอาไปเขียนในรายงาน — ตัวนี้ไม่ได้ดูภาพด้วยซ้ำ');
line();

/** ตัดก้อน base64 ให้สั้นลง ไม่งั้นหน้าจอเต็มไปด้วยขยะ */
function redactImages(json: string, indent: number): string {
  const pad = ' '.repeat(indent);
  return json
    .replace(/"(data:image\/[a-z]+;base64,)[^"]{20,}"/g, '"$1……(ภาพจริงยาวหลายแสนตัวอักษร)"')
    .replace(/"data":\s*"[^"]{20,}"/g, '"data": "……(ภาพจริงยาวหลายแสนตัวอักษร)"')
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}
