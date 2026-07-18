// src/shared/chat-title.ts — 순수 (electron/SDK 임포트 금지)
export function deriveTitle(firstUserMessage: string): string {
  const clean = firstUserMessage.replace(/\s+/g, ' ').trim();
  if (!clean) return '새 대화';
  return clean.length > 30 ? clean.slice(0, 30) + '…' : clean;
}
