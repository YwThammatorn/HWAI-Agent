import type { Criterion, Rubric, RuleSpec } from './types.ts';

/**
 * แปลง CSV rubric → Rubric object
 *
 * รูปแบบ CSV ที่รองรับ:
 *
 *   criterion_id,criterion_name,weight,max,layer,rule_kind,rule_param,cloIds,level_score,level_label,level_anchor
 *   C1,ความอ่านออกของตัวอักษร,0.2,3,rule,contrast,4.5,CLO2,0,ไม่ผ่าน,มีข้อความคอนทราสต์ต่ำเกินครึ่ง
 *   C1,ความอ่านออกของตัวอักษร,0.2,3,rule,contrast,4.5,CLO2,1,พอใช้,มีข้อความคอนทราสต์ต่ำบางจุด
 *   C1,ความอ่านออกของตัวอักษร,0.2,3,rule,contrast,4.5,CLO2,2,ดี,เกือบทุกข้อความผ่านเกณฑ์
 *   C1,ความอ่านออกของตัวอักษร,0.2,3,rule,contrast,4.5,CLO2,3,ดีมาก,ทุกข้อความผ่านเกณฑ์คอนทราสต์ 4.5:1
 *
 * เกณฑ์เดียวกันมีหลายแถว (คนละ level_score)
 * rule_param:
 *   - สำหรับ contrast = min ratio (ตัวเลข)
 *   - สำหรับ required-frames = ชื่อเฟรมคั่นด้วย semicolon (Home;Menu;Cart)
 *   - สำหรับ min-font-size = min pt (ตัวเลข)
 * cloIds คั่นด้วย semicolon (CLO1;CLO2)
 */

type CsvRow = {
  criterion_id: string;
  criterion_name: string;
  weight: string;
  max: string;
  layer: string;
  rule_kind: string;
  rule_param: string;
  cloIds: string;
  level_score: string;
  level_label: string;
  level_anchor: string;
};

const EXPECTED_HEADERS = [
  'criterion_id',
  'criterion_name',
  'weight',
  'max',
  'layer',
  'rule_kind',
  'rule_param',
  'cloIds',
  'level_score',
  'level_label',
  'level_anchor',
];

/**
 * คอลัมน์ cloIds รองรับหลายชื่อ header เพื่อความยืดหยุ่น
 * เพราะผู้ใช้อาจตั้งชื่อต่างกัน เช่น cloIds, clo_ids, CLOs, CLO, clos
 */
const CLO_HEADER_ALIASES = ['cloids', 'clo_ids', 'clos', 'clo', 'clo_id'];

export function parseCsvRubric(csvText: string, assignment = 'Assignment'): Rubric {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) {
    throw new Error('CSV rubric ต้องมีอย่างน้อย 1 header row + 1 data row');
  }

  const headers = parseCsvLine(lines[0]);
  validateHeaders(headers);

  const headerIdx = Object.fromEntries(headers.map((h, i) => [h.toLowerCase().trim(), i])) as Record<string, number>;

  // หา index ของคอลัมน์ cloIds (รองรับหลายชื่อ)
  const cloColName = Object.keys(headerIdx).find((h) => CLO_HEADER_ALIASES.includes(h));
  if (!cloColName) {
    throw new Error('ไม่พบคอลัมน์ cloIds');
  }
  headerIdx.cloIds = headerIdx[cloColName];

  // รวมแถวที่ criterion_id เดียวกัน
  const criterionMap = new Map<string, { meta: Omit<CsvRow, 'level_score' | 'level_label' | 'level_anchor'>; levels: { score: number; label: string; anchor: string }[] }>();

  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < headers.length) {
      throw new Error(`แถวที่ ${i + 1} มีคอลัมน์ไม่ครบ (คาด ${headers.length}, ได้ ${cols.length})`);
    }

    const row: CsvRow = {
      criterion_id: cols[headerIdx['criterion_id']].trim(),
      criterion_name: cols[headerIdx['criterion_name']].trim(),
      weight: cols[headerIdx['weight']].trim(),
      max: cols[headerIdx['max']].trim(),
      layer: cols[headerIdx['layer']].trim(),
      rule_kind: cols[headerIdx['rule_kind']].trim(),
      rule_param: cols[headerIdx['rule_param']].trim(),
      cloIds: (cols[headerIdx.cloIds] || '').trim(),
      level_score: cols[headerIdx['level_score']].trim(),
      level_label: cols[headerIdx['level_label']].trim(),
      level_anchor: cols[headerIdx['level_anchor']].trim(),
    };

    if (!row.criterion_id) throw new Error(`แถวที่ ${i + 1}: criterion_id ว่าง`);

    const existing = criterionMap.get(row.criterion_id);
    const level = {
      score: Number(row.level_score),
      label: row.level_label,
      anchor: row.level_anchor,
    };

    if (existing) {
      existing.levels.push(level);
    } else {
      criterionMap.set(row.criterion_id, {
        meta: {
          criterion_id: row.criterion_id,
          criterion_name: row.criterion_name,
          weight: row.weight,
          max: row.max,
          layer: row.layer,
          rule_kind: row.rule_kind,
          rule_param: row.rule_param,
          cloIds: row.cloIds,
        },
        levels: [level],
      });
    }
  }

  const criteria: Criterion[] = [];
  for (const [, entry] of criterionMap) {
    const m = entry.meta;
    const layer = m.layer as 'rule' | 'llm';
    if (layer !== 'rule' && layer !== 'llm') {
      throw new Error(`เกณฑ์ ${m.criterion_id}: layer ต้องเป็น "rule" หรือ "llm" (ได้ "${m.layer}")`);
    }

    const criterion: Criterion = {
      id: m.criterion_id,
      name: m.criterion_name,
      weight: Number(m.weight),
      max: Number(m.max),
      layer,
      levels: entry.levels.sort((a, b) => a.score - b.score),
      cloIds: m.cloIds
        ? m.cloIds
            .split(/[;,]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    };

    if (layer === 'rule') {
      criterion.rule = parseRuleSpec(m.rule_kind, m.rule_param);
    }

    criteria.push(criterion);
  }

  // ตรวจสอบน้ำหนัก
  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0);
  if (Math.abs(totalWeight - 1.0) > 0.01) {
    throw new Error(`น้ำหนักรวมต้องเท่ากับ 1.0 (ได้ ${totalWeight.toFixed(2)})`);
  }

  return {
    id: `rubric-${Date.now()}`,
    version: `csv-${new Date().toISOString().slice(0, 10)}`,
    assignment,
    criteria,
  };
}

function parseRuleSpec(kind: string, param: string): RuleSpec {
  switch (kind) {
    case 'contrast':
      return { kind: 'contrast', min: Number(param) };
    case 'min-font-size':
      return { kind: 'min-font-size', minPt: Number(param) };
    case 'required-frames':
      return { kind: 'required-frames', names: param.split(';').map((s) => s.trim()) };
    default:
      throw new Error(`ไม่รู้จัก rule_kind: "${kind}"`);
  }
}

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
          i++; // skip escaped quote
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
  return result;
}

function validateHeaders(headers: string[]): void {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  for (const expected of EXPECTED_HEADERS) {
    if (expected === 'cloIds') {
      // คอลัมน์ cloIds รองรับหลายชื่อ
      const found = normalized.some((h) => CLO_HEADER_ALIASES.includes(h));
      if (!found) {
        throw new Error(
          `CSV ขาดคอลัมน์ "cloIds" — หัวตารางต้องมีคอลัมน์ cloIds (รองรับ: ${CLO_HEADER_ALIASES.join(', ')})`
        );
      }
    } else if (!normalized.includes(expected)) {
      throw new Error(`CSV ขาดคอลัมน์ "${expected}" — หัวตารางต้องเป็น: ${EXPECTED_HEADERS.join(', ')}`);
    }
  }
}
