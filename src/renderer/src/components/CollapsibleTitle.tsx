import { VscChevronDown, VscChevronRight } from 'react-icons/vsc';

/** 패널 헤더 — 클릭하면 본문을 접었다 폈다 (VS Code 사이드바 섹션 스타일) */
export function CollapsibleTitle({
  title,
  collapsed,
  onToggle,
}: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="panel-title panel-title-collapsible" onClick={onToggle}>
      <span className="panel-chevron">{collapsed ? <VscChevronRight /> : <VscChevronDown />}</span>
      {title}
    </div>
  );
}
