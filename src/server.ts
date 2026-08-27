import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { parseCsvRubric } from './csv-rubric.ts';
import { pdfToSubmission } from './pdf-reader.ts';
import { ocrImage } from './ocr.ts';
import { GroqJudge } from './groq-judge.ts';
import { grade } from './grade.ts';
import { MockJudge } from './judge.ts';
import { anonymize } from './anonymize.ts';
import { buildPrompt } from './prompt.ts';

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
    } else if (req.method === 'GET' && req.url === '/api/health') {
      json(res, 200, { status: 'ok', time: new Date().toISOString() });
    } else if (req.method === 'POST' && req.url === '/api/grade') {
      await handleGrade(req, res);
    } else {
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

async function handleGrade(req: IncomingMessage, res: ServerResponse) {
  const body = await readJsonBody(req);

  const { rubricCsv, pdfBase64, pdfFileName, jpgBase64, jpgFileName, jpgMediaType, useMock } = body as {
    rubricCsv?: string;
    pdfBase64?: string | null;
    pdfFileName?: string | null;
    jpgBase64?: string | null;
    jpgFileName?: string | null;
    jpgMediaType?: string | null;
    useMock?: boolean;
  };

  if (!rubricCsv) {
    json(res, 400, { error: 'กรุณาอัปโหลดไฟล์ rubric (.csv)' });
    return;
  }
  if (!pdfBase64 && !jpgBase64) {
    json(res, 400, { error: 'กรุณาอัปโหลดไฟล์ PDF หรือ JPG อย่างใดอย่างหนึ่ง' });
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

  // 2. สร้าง Submission จากไฟล์ที่อัปโหลด
  let submission;
  try {
    if (pdfBase64) {
      // PDF → Submission (แต่ละหน้าเป็น frame)
      const pdfBuffer = Buffer.from(pdfBase64, 'base64');
      submission = await pdfToSubmission(pdfBuffer, pdfFileName || 'upload.pdf');
    } else {
      // JPG → Submission (ภาพเดียวเป็น frame เดียว + OCR ถอดข้อความ)
      submission = await jpgToSubmission(jpgBase64!, jpgFileName || 'upload.jpg', jpgMediaType || 'image/jpeg');
    }

    // ถ้ามีทั้ง PDF และ JPG ให้เพิ่มภาพเข้าไปใน submission ด้วย
    if (pdfBase64 && jpgBase64) {
      submission.images.push({
        frameId: submission.figma.frames[0]?.id || 'frame-1',
        mediaType: (jpgMediaType as 'image/jpeg') || 'image/jpeg',
        dataBase64: jpgBase64,
      });
    }
  } catch (err) {
    json(res, 400, { error: `ไม่สามารถอ่านไฟล์ได้: ${(err as Error).message}` });
    return;
  }

  // 3. เลือก judge
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

  // 4. รัน grading pipeline
  try {
    const record = await grade(submission, rubric, judge);

    // ข้อมูลไฟล์ที่อัปโหลด สำหรับ UI แสดงผล
    const fileInfo = {
      type: pdfBase64 ? 'pdf' : 'jpg',
      fileName: pdfBase64 ? (pdfFileName || 'upload.pdf') : (jpgFileName || 'upload.jpg'),
      pageCount: submission.figma.frames.length,
      hasImage: submission.images.length > 0,
      pages: submission.figma.frames.map((f) => ({
        id: f.id,
        name: f.name,
        textPreview: f.texts[0]?.content.slice(0, 200) || '(ไม่มีข้อความ)',
      })),
    };

    json(res, 200, { record, fileInfo, rubric });
  } catch (err) {
    json(res, 500, { error: `Grading ล้มเหลว: ${(err as Error).message}` });
  }
}

/**
 * แปลงไฟล์ภาพ (JPG/PNG) เป็น Submission
 * ภาพจะถูก encode เป็น base64 แล้วแนบใน GradingPrompt.images
 */
async function jpgToSubmission(
  jpgBase64: string,
  fileName: string,
  mediaType: string,
): Promise<Submission> {
  // ตรวจ media type
  const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!validTypes.includes(mediaType)) {
    throw new Error(`ไม่รองรับไฟล์ประเภท ${mediaType} — รองรับเฉพาะ JPG, PNG, GIF, WebP`);
  }

  // ตรวจว่า base64 ถูกต้อง
  try {
    Buffer.from(jpgBase64, 'base64');
  } catch {
    throw new Error('Base64 string ไม่ถูกต้อง');
  }

  // OCR — ถอดข้อความจากภาพ
  let ocrText = '';
  try {
    const ocr = await ocrImage(jpgBase64, mediaType);
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
    submissionId: `jpg-${Date.now()}`,
    student: {
      id: 'jpg-upload',
      name: 'Image Upload',
      email: 'image@upload.local',
    },
    groupName: 'Image Upload',
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
      dataBase64: jpgBase64,
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
