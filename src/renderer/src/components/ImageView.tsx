import { useEffect, useState } from 'react';

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
};

export function isImagePath(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return ext in IMAGE_MIME;
}

/** 에디터 영역 이미지 뷰어 — main에서 base64로 받아 data URL로 표시 */
export function ImageView({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setError(false);
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    void window.si
      .readFileBinary(path)
      .then((b64) => {
        if (!cancelled) setSrc(`data:${IMAGE_MIME[ext] ?? 'application/octet-stream'};base64,${b64}`);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <div className="image-view">
      {error ? <div className="hint">이미지를 읽을 수 없습니다</div> : src ? <img src={src} alt={path} /> : null}
    </div>
  );
}
