// src/renderer/src/chat-persist.ts — 활성 스레드 저장 디바운스 (순수 배선)
import { useAppStore } from './store';
import { deriveTitle } from '../../shared/chat-title';

let timer: ReturnType<typeof setTimeout> | null = null;

/** 대화 변경 시 호출 — 300ms 디바운스로 활성 스레드를 저장. activeThreadId 없으면 no-op.
 *  제목은 스레드 목록에 저장된 제목(사용자가 이름변경했을 수 있음)을 우선 사용하고,
 *  아직 목록에 없으면(최초 저장) 첫 사용자 메시지에서 파생한다. */
export function scheduleChatSave(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    const st = useAppStore.getState();
    const id = st.activeThreadId;
    if (!id || st.chatMessages.length === 0) return;
    const firstUser = st.chatMessages.find((m) => m.role === 'user');
    const title = st.threads.find((t) => t.id === id)?.title ?? deriveTitle(firstUser?.content ?? '');
    void window.si.chatThreadSave(id, title, st.chatMessages);
  }, 300);
}
