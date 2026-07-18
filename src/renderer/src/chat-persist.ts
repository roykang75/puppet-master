// src/renderer/src/chat-persist.ts — 활성 스레드 저장 디바운스 (순수 배선)
import { useAppStore } from './store';
import { deriveTitle } from '../../shared/chat-title';

let timer: ReturnType<typeof setTimeout> | null = null;

/** 대화 변경 시 호출 — 300ms 디바운스로 활성 스레드를 저장. activeThreadId 없으면 no-op.
 *  제목은 첫 사용자 메시지에서 파생(스레드 목록 갱신은 호출측이 필요 시 별도로). */
export function scheduleChatSave(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const st = useAppStore.getState();
    const id = st.activeThreadId;
    if (!id || st.chatMessages.length === 0) return;
    const firstUser = st.chatMessages.find((m) => m.role === 'user');
    const title = deriveTitle(firstUser?.content ?? '');
    void window.si.chatThreadSave(id, title, st.chatMessages);
  }, 300);
}
