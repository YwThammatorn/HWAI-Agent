import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { parseCsvRubric } from './rubric.ts';
import { pdfToSubmission } from './tool/pdf-reader.ts';
import { ocrImage } from './tool/ocr.ts';
import { GroqJudge } from './model.ts';
import { grade } from './grade.ts';
import { MockJudge } from './judge.ts';
import { anonymize } from './anonymize.ts';
import { buildPrompt } from './prompt.ts';
import { parseGroundTruthCsv, type GroundTruthData } from './ground-truth.ts';
import { evaluateGrading, exportEvaluationToCSV, exportDetailedCSV, type EvaluationResult } from './evaluation.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC_DIR = join(__dirname, '..', 'src', 'public');

const PORT = Number(process.env.PORT) || 3000;

// ══════════════════════════════════════════════════════════════════
//  HTTP Server
// ══════════════════════════════════════════════════════════════════

const server = createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      await serveStatic(res, 'index.html', 'text/html');
    } 
    else if (req.method === 'GET' && req.url === '/api/health') {
      json(res, 200, { status: 'ok', time: new Date().toISOString() });
    } 
    else if (req.method === 'POST' && req.url === '/api/grade') {
      await handleGrade(req, res);
    }
    else if (req.method === 'POST' && req.url === '/api/evaluate') {
      await handleEvaluate(req, res);
    }
    else {
      // serve static files
      const filePath = req.url?.slice(1) || 'index.html';
      const fullPath = join(PUBLIC_DIR, filePath);
      const s = await stat(fullPath).catch(() => null);
      if (s?.isFile()) {
        const ext = extname(fullPath);
        const mime: Record<string, string> = {
          '.html': 'text/html',
          '.css': 'text/css',
          '.js': 'application/javascript',
          '.json': 'application/json',
          '.png': 'image/png',
          '.svg': 'image/svg+xml',
        };
        await serveStatic(res, filePath, mime[ext] || 'application/octet-stream');
      } else {
        json(res, 404, { error: 'Not found' });
      }
    }
  } catch (err) {
    console.error('Server error:', err);
    json(res, 500, { error: (err as Error).message });
  }
});

server.listen(PORT, () => {
  console.log(`\n  🎓 HWAI Grading Agent`);
  console.log(`  ══════════════════════`);
  console.log(`  เปิดเบราว์เซอร์ไปที่ http://localhost:${PORT}`);
  console.log(`  API key: ${process.env.GROQ_API_KEY ? '✓ ตั้งค่าแล้ว' : '✗ ยังไม่ได้ตั้ง GROQ_API_KEY'}`);
  console.log();
});

// ══════════════════════════════════════════════════════════════════
//  handlers
// ══════════════════════════════════════════════════════════════════

type StudentInfo = {
  id: string;
  name: string;
  email: string;
};

type DocUpload = {
  base64: string;
  fileName: string;
  type: 'pdf' | 'image';
  mediaType: string;
};

type SubmissionInput = {
  mode?: 'single' | 'group';
  groupName?: string;
  students?: { id?: string; name?: string; email?: string }[];
  doc: DocUpload;
};

// ══════════════════════════════════════════════════════════════════
//  Ground Truth & Evaluation
// ══════════════════════════════════════════════════════════════════

// เก็บ ground truth data ชั่วคราวใน memory (production ควรใช้ DB)
let storedGroundTruth: GroundTruthData | null = null;
let storedGradingRecords: unknown[] = [];

/**
 * POST /api/evaluate
 * 
 * รับ:
 *   - groundTruthCsv: เนื้อหา CSV ของ ground truth (plain text)
 *   - groundTruthFileName: ชื่อไฟล์
 *   - gradingRecords: ผลการให้คะแนนจาก AI (GradingRecord[])
 *   - rubric: rubric ที่ใช้
 * 
 * คืน:
 *   - evaluationResult: ผล evaluation
 *   - csv: CSV export
 *   - detailedCSV: CSV รายละเอียด
 */
async function handleEvaluate(req: IncomingMessage, res: ServerResponse) {
  const body = await readJsonBody(req);

  const { groundTruthCsv, groundTruthFileName, gradingRecords, rubric } = body as {
    groundTruthCsv?: string;
    groundTruthFileName?: string;
    gradingRecords?: unknown[];
    rubric?: unknown;
  };

  if (!groundTruthCsv) {
    json(res, 400, { error: 'กรุณาอัปโหลดไฟล์ ground truth (.csv)' });
    return;
  }

  if (!gradingRecords || gradingRecords.length === 0) {
    json(res, 400, { error: 'ไม่มีผลการให้คะแนนจาก AI ให้เทียบ' });
    return;
  }

  if (!rubric) {
    json(res, 400, { error: 'กรุณาอัปโหลด rubric ด้วย' });
    return;
  }

  try {
    // 1. Parse ground truth CSV (ส่งเป็น plain text — encoding ถูกต้องจาก browser แล้ว)
    const groundTruth = parseGroundTruthCsv(groundTruthCsv, groundTruthFileName || 'ground_truth.csv');

    console.log(`\n  📊 Ground Truth: ${groundTruth.submissionCount} ชิ้นงาน × ${groundTruth.criterionCount} เกณฑ์`);
    console.log(`  📋 GT submission_ids: ${groundTruth.submissionIds.join(', ')}`);

    // 2. แปลง gradingRecords เป็น GradingRecord[]
    const records = gradingRecords as import('./types.ts').GradingRecord[];
    console.log(`  📋 Grading records: ${records.length} รายการ`);
    for (const r of records) {
      console.log(`     - submissionId=${r.submissionId} | alias=${r.alias} | fileName=${r.fileName} | studentId=${r.studentId} | studentName=${r.studentName}`);
    }

    // 3. Run evaluation
    const evaluationResult = evaluateGrading(records, groundTruth, rubric as import('./types.ts').Rubric);

    // 4. Export CSV
    const csv = exportEvaluationToCSV(evaluationResult);
    const detailedCSV = exportDetailedCSV(evaluationResult);

    // เก็บไว้สำหรับ export ทีหลัง
    storedGroundTruth = groundTruth;
    storedGradingRecords = gradingRecords;

    console.log(`  ✅ Evaluation สำเร็จ — ${evaluationResult.summary.totalPairs} คู่ข้อมูล`);
    console.log(`  📈 QWK: ${evaluationResult.summary.overallQWK.toFixed(3)} [${evaluationResult.summary.overallQWKCI[0].toFixed(3)}, ${evaluationResult.summary.overallQWKCI[1].toFixed(3)}]`);
    console.log(`  📊 Exact Agreement: ${(evaluationResult.summary.overallExactAgreement * 100).toFixed(1)}%`);
    console.log(`  📊 Adjacent Agreement: ${(evaluationResult.summary.overallAdjacentAgreement * 100).toFixed(1)}%`);
    console.log(`  📊 Bias: ${evaluationResult.summary.overallBias.toFixed(3)}`);
    console.log(`  📊 MAE: ${evaluationResult.summary.overallMAE.toFixed(3)}`);

    json(res, 200, {
      evaluationResult,
      csv,
      detailedCSV,
    });
  } catch (err) {
    console.error('  ❌ Evaluation error:', err);
    json(res, 400, { error: `Evaluation ล้มเหลว: ${(err as Error).message}` });
  }
}

async function handleGrade(req: IncomingMessage, res: ServerResponse) {
  const body = await readJsonBody(req);

  const { rubricCsv, submissions, useMock } = body as {
    rubricCsv?: string;
    submissions?: SubmissionInput[];
    useMock?: boolean;
  };

  if (!rubricCsv) {
    json(res, 400, { error: 'กรุณาอัปโหลดไฟล์ rubric (.csv)' });
    return;
  }
  if (!submissions || submissions.length === 0) {
    json(res, 400, { error: 'กรุณาเพิ่มชิ้นงานอย่างน้อย 1 ตัว' });
    return;
  }

  // 1. Parse rubric จาก CSV
  let rubric;
  try {
    rubric = parseCsvRubric(rubricCsv, 'Assignment from CSV');
  } catch (err) {
    json(res, 400, { error: `Rubric CSV ผิดรูปแบบ: ${(err as Error).message}` });
    return;
  }

  // 2. เลือก judge
  let judge;
  if (useMock) {
    judge = new MockJudge();
  } else {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      json(res, 500, {
        error: 'ยังไม่ได้ตั้ง GROQ_API_KEY environment variable — กรุณาตั้งค่าก่อนใช้งาน',
      });
      return;
    }
    judge = new GroqJudge(apiKey);
  }

  // 3. ประมวลผลทีละชิ้นงาน → grade ทีละตัว
  const results: {
    record: unknown;
    fileInfo: { type: string; fileName: string; pageCount: number; hasImage: boolean; pages: { id: string; name: string; textPreview: string }[] };
    fileName: string;
  }[] = [];
  const errors: { fileName: string; error: string }[] = [];

  for (const item of submissions) {
    const { doc } = item;

    // Students — แต่ละชิ้นงานมีรายชื่อสมาชิกของตัวเอง
    const students: StudentInfo[] = (item.students && item.students.length > 0)
      ? item.students.map(m => ({
          id: m.id || 'unknown',
          name: m.name || 'Unknown Student',
          email: m.email || 'unknown@upload.local',
        }))
      : [{ id: 'unknown', name: 'Unknown Student', email: 'unknown@upload.local' }];

    const groupName = item.groupName || (item.mode === 'group' ? 'Unknown Group' : '');

    // ประกอบ Submission
    try {
      let submission;
      if (doc.type === 'pdf') {
        const pdfBuffer = Buffer.from(doc.base64, 'base64');
        submission = await pdfToSubmission(pdfBuffer, doc.fileName || 'upload.pdf', students);
      } else {
        submission = await imageToSubmission(doc.base64, doc.fileName || 'upload.jpg', doc.mediaType || 'image/jpeg', students);
      }

      // ใส่ข้อมูลนักศึกษาทั้งหมดลง submission
      submission.student = students[0];
      submission.students = students;
      submission.groupName = groupName;

      // Grade
      const record = await grade(submission, rubric, judge);

      // File info สำหรับ UI
      const fileInfo = {
        type: doc.type,
        fileName: doc.fileName,
        pageCount: submission.figma.frames.length,
        hasImage: submission.images.length > 0,
        pages: submission.figma.frames.map((f) => ({
          id: f.id,
          name: f.name,
          textPreview: f.texts[0]?.content.slice(0, 200) || '(ไม่มีข้อความ)',
        })),
      };

      results.push({ record, fileInfo, fileName: doc.fileName });
      const label = students.length > 1 ? `${students.length} คน` : students[0].name;
      console.log(`  ✅ ${doc.fileName} (${label}) — ให้คะแนนเสร็จ`);
    } catch (err) {
      errors.push({ fileName: doc.fileName, error: (err as Error).message });
      console.error(`  ❌ ${doc.fileName} — ${(err as Error).message}`);
    }
  }

  if (results.length === 0 && errors.length > 0) {
    json(res, 400, {
      error: `ไม่สามารถให้คะแนนไฟล์ใดเลย: ${errors.map(e => `${e.fileName}: ${e.error}`).join('; ')}`,
    });
    return;
  }

  json(res, 200, { results, rubric, errors: errors.length > 0 ? errors : undefined });
}

/**
 * แปลงไฟล์ภาพ (JPG/PNG) เป็น Submission
 * ภาพจะถูก encode เป็น base64 แล้วแนบใน GradingPrompt.images
 */
async function imageToSubmission(
  imgBase64: string,
  fileName: string,
  mediaType: string,
  students: StudentInfo[],
) {
  // ตรวจ media type
  const validTypes = ['image/jpeg', 'image/png'];
  if (!validTypes.includes(mediaType)) {
    throw new Error(`ไม่รองรับไฟล์ประเภท ${mediaType} — รองรับเฉพาะ JPG, PNG`);
  }

  // ตรวจว่า base64 ถูกต้อง
  try {
    Buffer.from(imgBase64, 'base64');
  } catch {
    throw new Error('Base64 string ไม่ถูกต้อง');
  }

  // OCR — ถอดข้อความจากภาพ
  let ocrText = '';
  try {
    const ocr = await ocrImage(imgBase64, mediaType);
    ocrText = ocr.text;
    console.log(`  🔍 OCR ถอดข้อความสำเร็จ (${ocr.confidence.toFixed(1)}% confidence, ${ocr.durationMs}ms)`);
  } catch (err) {
    console.warn(`  ⚠️ OCR ล้มเหลว: ${(err as Error).message} — ใช้ภาพล้วน`);
  }

  // สร้าง TextNode จาก OCR text
  const texts = ocrText
    ? [{
        content: ocrText,
        fontSizePt: 12,
        color: '#000000',
        background: '#ffffff',
      }]
    : [];

  return {
    submissionId: `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    student: students[0],
    students,
    fileName,
    folderName: '',
    figma: {
      fileKey: '',
      frames: [{
        id: 'image-1',
        name: fileName,
        bbox: { x: 0, y: 0, w: 800, h: 600 },
        texts,
      }],
    },
    images: [{
      frameId: 'image-1',
      mediaType: mediaType as 'image/jpeg',
      dataBase64: imgBase64,
    }],
    externalUseConsent: true,
  };
}

// ══════════════════════════════════════════════════════════════════
//  utilities
// ══════════════════════════════════════════════════════════════════

async function serveStatic(res: ServerResponse, filePath: string, contentType: string) {
  const fullPath = join(PUBLIC_DIR, filePath);
  const content = await readFile(fullPath);
  res.writeHead(200, { 'content-type': contentType });
  res.end(content);
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data, null, 2));
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString();
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}
