import { useAppStore } from '../store';
import { ContextPanel } from './ContextPanel';
import { TerminalPanel } from './TerminalPanel';

export function BottomPanel() {
  const tab = useAppStore((s) => s.bottomTab);
  const setTab = useAppStore((s) => s.setBottomTab);
  return (
    <div className="panel">
      <div className="panel-title right-tabs">
        <button className={tab === 'context' ? 'active' : ''} onClick={() => setTab('context')}>Context</button>
        <button className={tab === 'terminal' ? 'active' : ''} onClick={() => setTab('terminal')}>Terminal</button>
      </div>
      <div className="panel-body" style={{ display: tab === 'context' ? undefined : 'none' }}>
        <ContextPanel />
      </div>
      <div className="panel-body" style={{ display: tab === 'terminal' ? undefined : 'none' }}>
        <TerminalPanel visible={tab === 'terminal'} />
      </div>
    </div>
  );
}
