import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseGroundTruthCsv } from '../src/ground-truth.ts';
import { evaluateGrading, exportEvaluationToCSV, exportDetailedCSV } from '../src/evaluation.ts';
import type { GradingRecord, Rubric } from '../src/types.ts';

// ══════════════════════════════════════════════════════════════════
//  Test: Ground Truth Parser
// ══════════════════════════════════════════════════════════════════

describe('parseGroundTruthCsv', () => {
  it('should parse long format CSV', () => {
    const csv = [
      'submission_id,criterion_id,score,reason',
      'S001,C1,3,ข้อมูลครบถ้วน',
      'S001,C2,2,ข้อมูลบางส่วน',
      'S002,C1,4,ดีมาก',
      'S002,C2,3,ดี',
    ].join('\n');

    const result = parseGroundTruthCsv(csv, 'test.csv');

    assert.equal(result.submissionCount, 2);
    assert.equal(result.criterionCount, 2);
    assert.equal(result.entries.length, 4);
    assert.deepEqual(result.submissionIds, ['S001', 'S002']);
    assert.deepEqual(result.criterionIds, ['C1', 'C2']);
  });

  it('should parse wide format CSV', () => {
    const csv = [
      'submission_id,C1_score,C1_reason,C2_score,C2_reason',
      'S001,3,ข้อมูลครบ,2,บางส่วน',
      'S002,4,ดีมาก,3,ดี',
    ].join('\n');

    const result = parseGroundTruthCsv(csv, 'test.csv');

    assert.equal(result.submissionCount, 2);
    assert.equal(result.criterionCount, 2);
    assert.equal(result.entries.length, 4);
  });

  it('should parse Thai column names', () => {
    const csv = [
      'รหัสชิ้นงาน,รหัสเกณฑ์,คะแนน,เหตุผล',
      'S001,C1,3,ข้อมูลครบถ้วน',
      'S001,C2,2,ข้อมูลบางส่วน',
    ].join('\n');

    const result = parseGroundTruthCsv(csv, 'test.csv');

    assert.equal(result.entries.length, 2);
    assert.equal(result.entries[0].score, 3);
  });

  it('should handle quoted fields', () => {
    const csv = [
      'submission_id,criterion_id,score,reason',
      'S001,C1,3,"ข้อมูลครบถ้วน, รูปภาพเหมาะสม"',
      'S002,C1,4,"ดีมาก"',
    ].join('\n');

    const result = parseGroundTruthCsv(csv, 'test.csv');

    assert.equal(result.entries.length, 2);
    assert.equal(result.entries[0].reason, 'ข้อมูลครบถ้วน, รูปภาพเหมาะสม');
  });

  it('should throw on missing submission_id column', () => {
    const csv = [
      'criterion_id,score,reason',
      'C1,3,test',
    ].join('\n');

    assert.throws(() => parseGroundTruthCsv(csv), /submission_id/);
  });

  it('should throw on missing criterion_id and score columns', () => {
    const csv = [
      'submission_id,reason',
      'S001,test',
    ].join('\n');

    assert.throws(() => parseGroundTruthCsv(csv), /ไม่พบคอลัมน์คะแนน/);
  });
});

// ══════════════════════════════════════════════════════════════════
//  Test: Evaluation Metrics
// ══════════════════════════════════════════════════════════════════

describe('evaluateGrading', () => {
  const mockRubric: Rubric = {
    id: 'test-rubric',
    version: 'v1',
    assignment: 'Test Assignment',
    criteria: [
      {
        id: 'C1',
        name: 'เกณฑ์ 1',
        weight: 0.5,
        max: 4,
        layer: 'llm',
        levels: [
          { score: 1, label: 'ปรับปรุง', anchor: 'test' },
          { score: 2, label: 'พอใช้', anchor: 'test' },
          { score: 3, label: 'ดี', anchor: 'test' },
          { score: 4, label: 'ดีมาก', anchor: 'test' },
        ],
        cloIds: ['CLO1'],
      },
      {
        id: 'C2',
        name: 'เกณฑ์ 2',
        weight: 0.5,
        max: 4,
        layer: 'llm',
        levels: [
          { score: 1, label: 'ปรับปรุง', anchor: 'test' },
          { score: 2, label: 'พอใช้', anchor: 'test' },
          { score: 3, label: 'ดี', anchor: 'test' },
          { score: 4, label: 'ดีมาก', anchor: 'test' },
        ],
        cloIds: ['CLO2'],
      },
    ],
  };

  const mockGradingRecords: GradingRecord[] = [
    {
      submissionId: 'S001',
      rubricId: 'test-rubric',
      rubricVersion: 'v1',
      alias: 'A1',
      scores: [
        { criterionId: 'C1', score: 3, reason: 'ดี', evidence: [{ frameId: 'f1', note: 'test' }], source: 'llm', producedBy: 'test' },
        { criterionId: 'C2', score: 2, reason: 'พอใช้', evidence: [{ frameId: 'f1', note: 'test' }], source: 'llm', producedBy: 'test' },
      ],
      weightedTotal: 0.625,
      status: 'awaiting-instructor',
      trace: [],
    },
    {
      submissionId: 'S002',
      rubricId: 'test-rubric',
      rubricVersion: 'v1',
      alias: 'A2',
      scores: [
        { criterionId: 'C1', score: 4, reason: 'ดีมาก', evidence: [{ frameId: 'f1', note: 'test' }], source: 'llm', producedBy: 'test' },
        { criterionId: 'C2', score: 3, reason: 'ดี', evidence: [{ frameId: 'f1', note: 'test' }], source: 'llm', producedBy: 'test' },
      ],
      weightedTotal: 0.875,
      status: 'awaiting-instructor',
      trace: [],
    },
  ];

  const mockGroundTruth = {
    fileName: 'test.csv',
    entries: [
      { submissionId: 'S001', criterionId: 'C1', score: 3, reason: 'ข้อมูลครบ' },
      { submissionId: 'S001', criterionId: 'C2', score: 2, reason: 'บางส่วน' },
      { submissionId: 'S002', criterionId: 'C1', score: 4, reason: 'ดีมาก' },
      { submissionId: 'S002', criterionId: 'C2', score: 3, reason: 'ดี' },
    ],
    submissionCount: 2,
    criterionCount: 2,
    submissionIds: ['S001', 'S002'],
    criterionIds: ['C1', 'C2'],
  };

  it('should evaluate grading correctly (perfect match)', () => {
    const result = evaluateGrading(mockGradingRecords, mockGroundTruth, mockRubric);

    assert.equal(result.summary.totalPairs, 4);
    assert.equal(result.summary.overallExactAgreement, 1);
    assert.equal(result.summary.overallAdjacentAgreement, 1);
    assert.equal(result.summary.overallBias, 0);
    assert.equal(result.summary.overallMAE, 0);
    assert.equal(result.criteria.length, 2);
  });

  it('should detect positive bias when AI scores higher', () => {
    const biasedRecords: GradingRecord[] = [
      {
        submissionId: 'S001',
        rubricId: 'test-rubric',
        rubricVersion: 'v1',
        alias: 'A1',
        scores: [
          { criterionId: 'C1', score: 4, reason: 'test', evidence: [{ frameId: 'f1', note: 'test' }], source: 'llm', producedBy: 'test' },
          { criterionId: 'C2', score: 3, reason: 'test', evidence: [{ frameId: 'f1', note: 'test' }], source: 'llm', producedBy: 'test' },
        ],
        weightedTotal: 0.875,
        status: 'awaiting-instructor',
        trace: [],
      },
    ];

    const result = evaluateGrading(biasedRecords, mockGroundTruth, mockRubric);
    assert.ok(result.summary.overallBias > 0, 'AI should have positive bias');
  });

  it('should detect negative bias when AI scores lower', () => {
    const biasedRecords: GradingRecord[] = [
      {
        submissionId: 'S001',
        rubricId: 'test-rubric',
        rubricVersion: 'v1',
        alias: 'A1',
        scores: [
          { criterionId: 'C1', score: 1, reason: 'test', evidence: [{ frameId: 'f1', note: 'test' }], source: 'llm', producedBy: 'test' },
          { criterionId: 'C2', score: 1, reason: 'test', evidence: [{ frameId: 'f1', note: 'test' }], source: 'llm', producedBy: 'test' },
        ],
        weightedTotal: 0.25,
        status: 'awaiting-instructor',
        trace: [],
      },
    ];

    const result = evaluateGrading(biasedRecords, mockGroundTruth, mockRubric);
    assert.ok(result.summary.overallBias < 0, 'AI should have negative bias');
  });

  it('should export CSV correctly', () => {
    const result = evaluateGrading(mockGradingRecords, mockGroundTruth, mockRubric);
    const csv = exportEvaluationToCSV(result);

    assert.ok(csv.includes('criterion_id'));
    assert.ok(csv.includes('C1'));
    assert.ok(csv.includes('C2'));
    assert.ok(csv.includes('Summary'));
    assert.ok(csv.includes('QWK'));
  });

  it('should export detailed CSV correctly', () => {
    const result = evaluateGrading(mockGradingRecords, mockGroundTruth, mockRubric);
    const csv = exportDetailedCSV(result);

    assert.ok(csv.includes('submission_id'));
    assert.ok(csv.includes('ai_score'));
    assert.ok(csv.includes('gt_score'));
    assert.ok(csv.includes('S001'));
    assert.ok(csv.includes('S002'));
  });
});
