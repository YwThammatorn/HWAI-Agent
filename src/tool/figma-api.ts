/**
 * Figma API client — ดึง node tree จากไฟล์ Figma สาธารณะ
 * แล้วแปลงเป็น Frame[] ที่ pipeline ของระบบตรวจงานใช้ได้เลย
 *
 * ใช้ Figma REST API:
 *   GET https://api.figma.com/v1/files/:key?ids=:nodeId
 *   GET https://api.figma.com/v1/images/:key?ids=:nodeIds&format=png&scale=2
 *
 * ต้องมี FIGMA_API_KEY (Personal Access Token) ใน environment
 */

import type { Frame, TextNode, Submission } from '../types.ts';
// import type { RenderedImage } from '../types.ts'; // ปิดไว้ก่อน — ยังไม่ดึงรูป

// ══════════════════════════════════════════════════════════════════
//  Figma URL Parser
// ══════════════════════════════════════════════════════════════════

export type ParsedFigmaUrl = {
  fileKey: string;
  nodeId: string;
  fileName: string;
};

/**
 * Parse Figma URL ได้ทั้งแบบ:
 *   https://www.figma.com/design/:key/:name?node-id=X-Y
 *   https://www.figma.com/file/:key/:name?node-id=X-Y
 *   https://www.figma.com/proto/:key/:name?node-id=X-Y
 */
export function parseFigmaUrl(url: string): ParsedFigmaUrl {
  const normalized = url.trim();

  // จับ pattern: /design/:key/:name หรือ /file/:key/:name
  const match = normalized.match(
    /figma\.com\/(?:design|file|proto)\/([a-zA-Z0-9]+)\/([^?/]+)/,
  );
  if (!match) {
    throw new Error(
      `URL ไม่ถูกต้อง — ต้องเป็น Figma URL ที่มีรูปแบบ https://www.figma.com/design/:key/:name`,
    );
  }

  const fileKey = match[1];
  const fileName = decodeURIComponent(match[2]);

  // จับ node-id (รองรับทั้ง format "0-1" และ "0:1")
  const nodeMatch = normalized.match(/[?&]node-id=([^&]+)/);
  if (!nodeMatch) {
    throw new Error(
      'URL ไม่มี node-id parameter — กรุณาใส่ ?node-id=X-Y ใน URL',
    );
  }

  // Figma URL ใช้ "-" คั่น แต่ API ใช้ ":"
  const nodeId = nodeMatch[1].replace(/-/g, ':');

  return { fileKey, nodeId, fileName };
}

// ══════════════════════════════════════════════════════════════════
//  Figma API Node Types (subset ที่เราใช้)
// ══════════════════════════════════════════════════════════════════

type FigmaColor = { r: number; g: number; b: number; a?: number };

type FigmaPaint = {
  type: string;
  color?: FigmaColor;
  opacity?: number;
};

type FigmaNode = {
  id: string;
  name: string;
  type: string;
  absoluteBoundingBox?: { x: number; y: number; width: number; height: number };
  fills?: FigmaPaint[];
  style?: {
    fontFamily?: string;
    fontSize?: number;
    lineHeightPx?: number;
    letterSpacing?: number;
  };
  characters?: string;
  children?: FigmaNode[];
};

type FigmaFileResponse = {
  name?: string;
  document?: FigmaNode;
  nodes?: Record<string, { document: FigmaNode }>;
  err?: string;
};

// type FigmaImagesResponse = {
//   err?: string;
//   images?: Record<string, string | null>;
// };

// ══════════════════════════════════════════════════════════════════
//  Color Utilities
// ══════════════════════════════════════════════════════════════════

function rgbaToHex(color: FigmaColor): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function getFillColor(node: FigmaNode): string {
  // หา fill ตัวแรกที่เป็น SOLID
  if (node.fills && node.fills.length > 0) {
    const solidFill = node.fills.find(
      (f) => f.type === 'SOLID' && f.color,
    );
    if (solidFill?.color) {
      return rgbaToHex(solidFill.color);
    }
  }
  return '#ffffff'; // default: white
}

// ══════════════════════════════════════════════════════════════════
//  Node Tree Traversal
// ══════════════════════════════════════════════════════════════════

/**
 * ดึง TEXT nodes ทั้งหมดจาก subtree ของ node นี้
 * ค้นหาแบบ recursive — Figma อาจมี text ซ้อนใน component, group, frame
 */
function collectTextNodes(node: FigmaNode): TextNode[] {
  const texts: TextNode[] = [];

  if (node.type === 'TEXT' && node.characters) {
    // Figma ให้ font size เป็น px — แปลงเป็น pt (1pt = 1.333px)
    const fontSizePx = node.style?.fontSize ?? 12;
    const fontSizePt = Math.round((fontSizePx / 1.333) * 10) / 10;

    texts.push({
      content: node.characters,
      fontSizePt,
      color: getFillColor(node),
      background: '#ffffff', // default — Figma ไม่ให้ background ตรง ๆ ที่ text node
    });
  }

  if (node.children) {
    for (const child of node.children) {
      texts.push(...collectTextNodes(child));
    }
  }

  return texts;
}

/**
 * ค้นหา FRAME / COMPONENT / SECTION nodes ที่เป็น top-level screens
 * ใน Figma design แต่ละ frame มักคือ "หน้าจอ" หนึ่งหน้า
 */
function findFrames(node: FigmaNode): FigmaNode[] {
  const frames: FigmaNode[] = [];

  const FRAME_TYPES = new Set(['FRAME', 'COMPONENT', 'SECTION']);

  if (FRAME_TYPES.has(node.type) && node.absoluteBoundingBox) {
    // ตรวจสอบว่าเป็น "หน้าจอ" (ขนาดพอ ๆ กับหน้าจอ)
    const box = node.absoluteBoundingBox;
    const minDimension = 200; // ขั้นต่ำที่ถือว่าเป็น screen
    if (box.width >= minDimension && box.height >= minDimension) {
      frames.push(node);
    }
  }

  // ค้นหา children — ถ้าเจอ frame แล้วไม่ต้องค้นลึกกว่านั้น
  if (node.children) {
    for (const child of node.children) {
      if (FRAME_TYPES.has(node.type) && frames.length > 0) {
        // ถ้าเป็น frame แล้วเจอ frame ลูก ให้ข้าม (เก็บเฉพาะ top-level)
        continue;
      }
      frames.push(...findFrames(child));
    }
  }

  return frames;
}

/**
 * สร้าง Frame objects จาก Figma nodes
 * ถ้าไม่เจอ frame ใดเลย ใช้ document root เป็น frame เดียว
 */
function buildFrames(root: FigmaNode): FigmaNode[] {
  const frames = findFrames(root);
  if (frames.length === 0) {
    // ไม่มี frame ย่อย — ใช้ root เอง
    return [root];
  }
  return frames;
}

// ══════════════════════════════════════════════════════════════════
//  Main API Functions
// ══════════════════════════════════════════════════════════════════

export type FigmaData = {
  fileKey: string;
  fileName: string;
  nodeId: string;
  frames: Frame[];
  // imageUrls: Record<string, string>; // ปิดไว้ก่อน — ยังไม่ดึงรูป
};

/**
 * ดึงข้อมูลจาก Figma API — node tree + image URLs
 *
 * @param apiKey - Figma Personal Access Token
 * @param parsed - parsed URL data from parseFigmaUrl()
 */
export async function fetchFigmaData(
  apiKey: string,
  parsed: ParsedFigmaUrl,
): Promise<FigmaData> {
  const { fileKey, nodeId, fileName } = parsed;

  // 1. ลองพิมพ์ออกมาดูใน Terminal ว่าตัวแปร apiKey หน้าตาเป็นอย่างไร
  console.log("-----------------------------------------");
  console.log("🔍 ประเภทของ apiKey:", typeof apiKey);
  console.log("🔍 ค่าของ apiKey ใน Node.js:", apiKey);
  console.log("-----------------------------------------");

  // ── 1. ดึง node tree ──
  const fileUrl = `https://api.figma.com/v1/files/${fileKey}?ids=${encodeURIComponent(nodeId)}&depth=10`;
  console.log(`  🎨 Figma: ดึง node tree จาก file ${fileKey}, node ${nodeId}`);

  const fileRes = await fetch(fileUrl, {
    headers: { 'X-Figma-Token': apiKey },
  });

  if (!fileRes.ok) {
    const errText = await fileRes.text();
    if (fileRes.status === 403) {
      throw new Error(
        `Figma API ตอบ 403 — ตรวจสอบ FIGMA_API_KEY หรือตรวจสอบว่าไฟล์เปิดเป็น public แล้ว ${fileRes.status}: ${errText}`,
      );
    }
    throw new Error(`Figma API ตอบ ${fileRes.status}: ${errText}`);
  }

  const fileData = (await fileRes.json()) as FigmaFileResponse;
  if (fileData.err) {
    throw new Error(`Figma API error: ${fileData.err}`);
  }

  // หา document node
  let rootNode: FigmaNode | undefined;
  if (fileData.nodes && fileData.nodes[nodeId]) {
    rootNode = fileData.nodes[nodeId].document;
  } else if (fileData.document) {
    rootNode = fileData.document;
  }

  if (!rootNode) {
    throw new Error(
      `ไม่พบ node ${nodeId} ในไฟล์ Figma — ตรวจสอบว่า URL ถูกต้องและไฟล์เปิดเป็น public`,
    );
  }

  // ── 2. สร้าง frames จาก node tree ──
  const figmaFrames = buildFrames(rootNode);
  const frames: Frame[] = figmaFrames.map((f) => ({
    id: f.id,
    name: f.name,
    bbox: f.absoluteBoundingBox
      ? {
          x: f.absoluteBoundingBox.x,
          y: f.absoluteBoundingBox.y,
          w: f.absoluteBoundingBox.width,
          h: f.absoluteBoundingBox.height,
        }
      : { x: 0, y: 0, w: 800, h: 600 },
    texts: collectTextNodes(f),
  }));

  console.log(`  🎨 Figma: พบ ${frames.length} frames`);

  // ── 3. ดึงรูปภาพของแต่ละ frame ──
  // ปิดไว้ก่อน — ลองส่งแค่ node tree ไปตรวจก่อน
  // const nodeIds = frames.map((f) => f.id).join(',');
  // const imageUrl = `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(nodeIds)}&format=png&scale=2`;
  //
  // let imageUrls: Record<string, string> = {};
  // if (frames.length > 0) {
  //   const imgRes = await fetch(imageUrl, {
  //     headers: { 'X-Figma-Token': apiKey },
  //   });
  //
  //   if (imgRes.ok) {
  //     const imgData = (await imgRes.json()) as FigmaImagesResponse;
  //     if (imgData.images) {
  //       imageUrls = Object.fromEntries(
  //         Object.entries(imgData.images).filter(([, v]) => v !== null) as [string, string][],
  //       );
  //       console.log(`  🎨 Figma: ดึงรูปภาพได้ ${Object.keys(imageUrls).length} รูป`);
  //     }
  //   } else {
  //     console.warn(`  ⚠️ Figma: ไม่สามารถดึงรูปภาพได้ (ไม่กระทบการตรวจข้อความ)`);
  //   }
  // }

  return { fileKey, fileName, nodeId, frames };
}

// /**
//  * ดาวน์โหลดรูปภาพจาก Figma แล้วแปลงเป็น base64
//  * ปิดไว้ก่อน — ยังไม่ดึงรูป
//  */
// async function downloadImageAsBase64(url: string): Promise<{ base64: string; mediaType: string }> {
//   const res = await fetch(url);
//   if (!res.ok) throw new Error(`ดาวน์โหลดรูปภาพไม่สำเร็จ: ${res.status}`);
//
//   const contentType = res.headers.get('content-type') || 'image/png';
//   const buffer = await res.arrayBuffer();
//   const base64 = Buffer.from(buffer).toString('base64');
//
//   return { base64, mediaType: contentType };
// }

/**
 * แปลง FigmaData เป็น Submission ที่ pipeline ใช้ได้
 *
 * @param figmaData - ข้อมูลที่ดึงมาจาก Figma API
 * @param students - ข้อมูลนักศึกษา (ถ้ามี)
 */
export async function figmaToSubmission(
  figmaData: FigmaData,
  students: { id: string; name: string; email: string }[] = [],
): Promise<Submission> {
  const { fileKey, fileName, frames } = figmaData;

  // ปิดไว้ก่อน — ลองส่งแค่ node tree ไปตรวจก่อน
  // const images: RenderedImage[] = [];
  // for (const frame of frames) {
  //   const imgUrl = imageUrls[frame.id];
  //   if (imgUrl) {
  //     try {
  //       const { base64, mediaType } = await downloadImageAsBase64(imgUrl);
  //       images.push({
  //         frameId: frame.id,
  //         mediaType: mediaType as 'image/png',
  //         dataBase64: base64,
  //       });
  //     } catch (err) {
  //       console.warn(`  ⚠️ ดาวน์โหลดรูป ${frame.name} ไม่สำเร็จ: ${(err as Error).message}`);
  //     }
  //   }
  // }

  const memberList = students.length > 0
    ? students
    : [{ id: 'figma-upload', name: 'Figma Upload', email: 'figma@upload.local' }];

  return {
    submissionId: `figma-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    student: memberList[0],
    students: memberList,
    fileName,
    folderName: '',
    figma: { fileKey, frames },
    images: [], // ยังไม่ดึงรูป — ใช้ node tree ล้วนก่อน
    externalUseConsent: true,
  };
}
