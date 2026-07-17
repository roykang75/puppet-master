import { useAppStore } from '../store';
import { RelationPanel } from './RelationPanel';
import { ChatPanel } from './ChatPanel';

export function RightPanel() {
  const tab = useAppStore((s) => s.rightTab);
  const setTab = useAppStore((s) => s.setRightTab);
  return (
    <div className="panel">
      <div className="panel-title right-tabs">
        <button className={tab === 'relation' ? 'active' : ''} onClick={() => setTab('relation')}>Relation</button>
        <button className={tab === 'chat' ? 'active' : ''} onClick={() => setTab('chat')}>AI 채팅</button>
      </div>
      <div className="panel-body">{tab === 'relation' ? <RelationPanel /> : <ChatPanel />}</div>
    </div>
  );
}
