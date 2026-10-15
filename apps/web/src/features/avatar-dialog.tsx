import { useEffect, useRef, type ReactNode } from 'react';
export function AvatarDialog({
  children,
  crop = false,
  busy = false,
  onDismiss,
  label = '头像',
}: {
  children: ReactNode;
  crop?: boolean;
  busy?: boolean;
  onDismiss: () => void;
  label?: string;
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
      aria-label={crop ? `调整${label}` : `选择${label}来源`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onDismiss();
      }}
    >
      {children}
    </dialog>
  );
}
