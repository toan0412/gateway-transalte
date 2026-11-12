const enc = new TextEncoder();
export const byteLen = (s: string) => enc.encode(s).length;

/** Cắt một đoạn thành các mảnh ≤ maxBytes, ưu tiên ranh giới câu, rồi khoảng trắng. */
export function splitText(text: string, maxBytes: number): string[] {
  if (byteLen(text) <= maxBytes) return [text];
  const sentences = text.match(/[^.!?。！？\n]+[.!?。！？]*\s*|\n+/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  const flush = () => {
    if (cur) out.push(cur);
    cur = "";
  };
  for (const s of sentences) {
    if (byteLen(cur + s) <= maxBytes) {
      cur += s;
      continue;
    }
    flush();
    if (byteLen(s) <= maxBytes) {
      cur = s;
      continue;
    }
    // câu quá dài: cắt theo từ, rồi theo ký tự
    for (const w of s.split(/(?<=\s)/)) {
      if (byteLen(cur + w) <= maxBytes) cur += w;
      else {
        flush();
        if (byteLen(w) <= maxBytes) cur = w;
        else for (const ch of w) {
          if (byteLen(cur + ch) > maxBytes) flush();
          cur += ch;
        }
      }
    }
  }
  flush();
  return out;
}

export interface Piece {
  index: number; // văn bản gốc nào
  text: string;
}

export interface ChunkLimits {
  maxBytes: number;
  maxItems: number;
  maxTotalBytes: number;
}

/**
 * Chia các văn bản thành các lô. Mỗi mảnh ≤ maxBytes, mỗi lô ≤ maxItems mảnh
 * và tổng ≤ maxTotalBytes.
 */
export function planBatches(texts: string[], lim: ChunkLimits): Piece[][] {
  const batches: Piece[][] = [];
  let cur: Piece[] = [];
  let size = 0;
  for (let i = 0; i < texts.length; i++) {
    for (const part of splitText(texts[i], lim.maxBytes)) {
      const b = byteLen(part);
      if (cur.length && (cur.length >= lim.maxItems || size + b > lim.maxTotalBytes)) {
        batches.push(cur);
        cur = [];
        size = 0;
      }
      cur.push({ index: i, text: part });
      size += b;
    }
  }
  if (cur.length) batches.push(cur);
  return batches;
}

/** Ghép lại các mảnh đã dịch theo chỉ số văn bản gốc. */
export function assemble(count: number, pieces: Piece[]): string[] {
  const parts: string[][] = Array.from({ length: count }, () => []);
  for (const p of pieces) parts[p.index].push(p.text);
  return parts.map((p) => p.map((s) => s.trim()).join(" "));
}
