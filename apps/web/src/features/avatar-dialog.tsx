import { useEffect, useRef, type ReactNode } from 'react';
export function AvatarDialog({
  children,
  crop = false,
  busy = false,
  onDismiss,
}: {
  children: ReactNode;
  crop?: boolean;
  busy?: boolean;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => {
      if (typeof dialog.close === 'function') dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={crop ? 'avatar-crop-dialog stack' : 'avatar-source-dialog stack'}
      aria-label={crop ? '调整头像' : '选择头像来源'}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onDismiss();
      }}
    >
      {children}
    </dialog>
  );
}
