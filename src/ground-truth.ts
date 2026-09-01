/**
 * ตัวแปลง CSV Ground Truth → GroundTruthData
 *
 * รูปแบบ CSV ที่รองรับ:
 *
 * แบบที่ 1: Long Format (แนะนำ — เหมือน rubric)
 *   submission_id,criterion_id,score,reason
 *   S001,C1,3,ข้อมูลครบถ้วน
 *   S001,C2,2,ข้อมูลบางส่วน
 *
 * แบบที่ 2: Wide Format
 *   submission_id,C1_score,C1_reason,C2_score,C2_reason
 *   S001,3,ข้อมูลครบ,2,บางส่วน
 *
 * คอลัมน์ที่รองรับ (ทั้งไทยและอังกฤษ):
 *   submission_id / student_id / file_name / รหัสชิ้นงาน / รหัสนักศึกษา / ชื่อไฟล์
 *   criterion_id / criterion / รหัสเกณฑ์ / เกณฑ์
 *   score / grade / points / คะแนน
 *   reason / comment / feedback / เหตุผล / คำอธิบาย
 *   student_name / name / ชื่อนักศึกษา / ชื่อ  (optional)
 *   group_name / group / กลุ่ม / ชื่อกลุ่ม      (optional)
 */

/**
 * ข้อมูล ground truth ของแต่ละเกณฑ์ในแต่ละชิ้นงาน
 */
export type GroundTruthEntry = {
  submissionId: string;
  criterionId: string;
  score: number;
  reason: string;
  studentName?: string;
  groupName?: string;
};

/**
 * ผลลัพธ์จากการ parse ground truth file
 */
export type GroundTruthData = {
  fileName: string;
  entries: GroundTruthEntry[];
  submissionCount: number;
  criterionCount: number;
  submissionIds: string[];
  criterionIds: string[];
};

// ── Column name mappings ──

const SUBMISSION_ID_NAMES = [
  'submission_id', 'submission id', 'submissionid',
  'student_id', 'student id', 'studentid',
  'file_name', 'file name', 'filename',
  'รหัสชิ้นงาน', 'รหัสนักศึกษา', 'ชื่อไฟล์',
];

const CRITERION_ID_NAMES = [
  'criterion_id', 'criterion id', 'criterionid', 'criterion',
  'รหัสเกณฑ์', 'เกณฑ์',
];

const SCORE_NAMES = [
  'score', 'grade', 'points',
  'คะแนน',
];

const REASON_NAMES = [
  'reason', 'reasoning', 'comment', 'comments', 'feedback',
  'เหตุผล', 'คำอธิบาย', 'ข้อคิดเห็น',
];

const STUDENT_NAME_NAMES = [
  'student_name', 'student name', 'studentname', 'name',
  'ชื่อนักศึกษา', 'ชื่อ',
];

const GROUP_NAME_NAMES = [
  'group_name', 'group name', 'groupname', 'group',
  'กลุ่ม', 'ชื่อกลุ่ม',
];

/**
 * ตรวจสอบว่า header ตรงกับรายการชื่อที่กำหนดหรือไม่
 */
function matchHeader(header: string, names: string[]): boolean {
  const normalized = header.toLowerCase().trim();
  return names.some((n) => normalized === n);
}

/**
 * หา index ของคอลัมน์ที่ตรงกับชื่อที่กำหนด
 */
function findColumn(headers: string[], names: string[]): number {
  return headers.findIndex((h) => matchHeader(h, names));
}

// ══════════════════════════════════════════════════════════════════
//  CSV Parser (รองรับ quoted fields)
// ══════════════════════════════════════════════════════════════════

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current);
  console.log(result)
  return result;
}

// ══════════════════════════════════════════════════════════════════
//  Main parser
// ══════════════════════════════════════════════════════════════════

export function parseGroundTruthCsv(csvText: string, fileName = 'ground_truth.csv'): GroundTruthData {
  // ลบ BOM (Byte Order Mark) ที่ Excel/Google Sheets มักใส่ไว้ต้นไฟล์
  const cleaned = csvText.replace(/^\uFEFF/, '');
  const lines = cleaned.split(/\r?\n/).filter((l) => l.trim() !== '');
  
  if (lines.length < 2) {
    throw new Error('CSV ground truth ต้องมีอย่างน้อย 1 header row + 1 data row');
  }

  const headers = parseCsvLine(lines[0]);

  // หาคอลัมน์หลัก
  const submissionIdx = findColumn(headers, SUBMISSION_ID_NAMES);
  const criterionIdx = findColumn(headers, CRITERION_ID_NAMES);

  if (submissionIdx === -1) {
    throw new Error(
      `ไม่พบคอลัมน์ submission_id — ต้องมีคอลัมน์: ${SUBMISSION_ID_NAMES.slice(0, 4).join(', ')}`,
    );
  }

  // ตรวจว่าเป็น long format หรือ wide format
  // Long format: มีทั้ง criterion_id และ score columns
  // Wide format: ไม่มี criterion_id แต่มี C1_score, C2_score ฯลฯ
  const hasScoreColumn = findColumn(headers, SCORE_NAMES) !== -1;
  const isLongFormat = criterionIdx !== -1 && hasScoreColumn;

  if (isLongFormat) {
    // Long format: submission_id, criterion_id, score, reason
    return parseLongFormat(lines, headers, submissionIdx, criterionIdx, fileName);
  } else {
    // Wide format: submission_id, C1_score, C1_reason, ...
    return parseWideFormat(lines, headers, submissionIdx, fileName);
  }
}

// ══════════════════════════════════════════════════════════════════
//  Long Format: submission_id | criterion_id | score | reason
// ══════════════════════════════════════════════════════════════════

function parseLongFormat(
  lines: string[],
  headers: string[],
  submissionIdx: number,
  criterionIdx: number,
  fileName: string,
): GroundTruthData {
  const scoreIdx = findColumn(headers, SCORE_NAMES);
  const reasonIdx = findColumn(headers, REASON_NAMES);
  const studentNameIdx = findColumn(headers, STUDENT_NAME_NAMES);
  const groupNameIdx = findColumn(headers, GROUP_NAME_NAMES);

  const entries: GroundTruthEntry[] = [];
  const submissionIds = new Set<string>();
  const criterionIds = new Set<string>();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const submissionId = (cols[submissionIdx] || '').trim();
    const criterionId = (cols[criterionIdx] || '').trim();

    if (!submissionId || !criterionId) continue;

    const score = scoreIdx >= 0 ? Number(cols[scoreIdx]) || 0 : 0;
    const reason = reasonIdx >= 0 ? (cols[reasonIdx] || '').trim() : '';
    const studentName = studentNameIdx >= 0 ? (cols[studentNameIdx] || '').trim() : undefined;
    const groupName = groupNameIdx >= 0 ? (cols[groupNameIdx] || '').trim() : undefined;

    console.log({
      submissionId,
      criterionId,
      score,
      reason,
      studentName: studentName || undefined,
      groupName: groupName || undefined,
    })

    entries.push({
      submissionId,
      criterionId,
      score,
      reason,
      studentName: studentName || undefined,
      groupName: groupName || undefined,
    });

    submissionIds.add(submissionId);
    criterionIds.add(criterionId);
  }

  if (entries.length === 0) {
    throw new Error(
      'ไม่พบข้อมูลที่ถูกต้องใน CSV — ต้องมีคอลัมน์ submission_id และ criterion_id อย่างน้อย',
    );
  }

  return {
    fileName,
    entries,
    submissionCount: submissionIds.size,
    criterionCount: criterionIds.size,
    submissionIds: [...submissionIds].sort(),
    criterionIds: [...criterionIds].sort(),
  };
}

// ══════════════════════════════════════════════════════════════════
//  Wide Format: submission_id | C1_score | C1_reason | C2_score | ...
// ══════════════════════════════════════════════════════════════════

function parseWideFormat(
  lines: string[],
  headers: string[],
  submissionIdx: number,
  fileName: string,
): GroundTruthData {
  const entries: GroundTruthEntry[] = [];
  const submissionIds = new Set<string>();
  const criterionIds = new Set<string>();

  // หาคอลัมน์ score/reason ของแต่ละเกณฑ์
  const criterionPattern = /^([A-Za-z0-9]+)[_\-\s]*(score|reason|คะแนน|เหตุผล)$/i;

  const columnMap = new Map<number, { criterionId: string; fieldType: 'score' | 'reason' }>();
  for (let j = 0; j < headers.length; j++) {
    if (j === submissionIdx) continue;
    const match = headers[j].match(criterionPattern);
    if (match) {
      const fieldType = (match[2].toLowerCase() === 'score' || match[2] === 'คะแนน') ? 'score' : 'reason';
      columnMap.set(j, { criterionId: match[1], fieldType });
    }
  }

  if (columnMap.size === 0) {
    throw new Error(
      'ไม่พบคอลัมน์คะแนนใน wide format — ต้องมีคอลัมน์เช่น C1_score, C1_reason',
    );
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const submissionId = (cols[submissionIdx] || '').trim();
    if (!submissionId) continue;
    submissionIds.add(submissionId);

    const tempMap = new Map<string, { score?: number; reason?: string }>();

    for (const [j, { criterionId, fieldType }] of columnMap) {
      criterionIds.add(criterionId);
      if (!tempMap.has(criterionId)) tempMap.set(criterionId, {});
      const entry = tempMap.get(criterionId)!;
      if (fieldType === 'score') {
        entry.score = Number(cols[j]) || 0;
      } else {
        entry.reason = (cols[j] || '').trim();
      }
    }

    for (const [criterionId, data] of tempMap) {
      entries.push({
        submissionId,
        criterionId,
        score: data.score ?? 0,
        reason: data.reason ?? '',
      });
    }
  }

  if (entries.length === 0) {
    throw new Error(
      'ไม่พบข้อมูลคะแนนใน wide format — ต้องมีคอลัมน์เช่น C1_score, C1_reason',
    );
  }

  return {
    fileName,
    entries,
    submissionCount: submissionIds.size,
    criterionCount: criterionIds.size,
    submissionIds: [...submissionIds].sort(),
    criterionIds: [...criterionIds].sort(),
  };
}

/**
 * ดึงคะแนน ground truth สำหรับ submission + criterion เฉพาะ
 */
export function getGroundTruthScore(
  gt: GroundTruthData,
  submissionId: string,
  criterionId: string,
): GroundTruthEntry | undefined {
  return gt.entries.find(
    (e) => e.submissionId === submissionId && e.criterionId === criterionId,
  );
}
