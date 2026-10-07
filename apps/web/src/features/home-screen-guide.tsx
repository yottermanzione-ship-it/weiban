import { useEffect, useRef, useState } from 'react';
import { Share, PlusSquare, House } from '@phosphor-icons/react';

const seenKey = 'weiban:home-screen-guide-seen';
function device() {
  const ua = navigator.userAgent;
  const version = /OS (\d+)_(\d+)/.exec(ua);
  const supported = !!version && (+version[1]! > 16 || (+version[1]! === 16 && +version[2]! >= 4));
  const installed =
    window.matchMedia('(display-mode: standalone)').matches ||
    ('standalone' in navigator && navigator.standalone === true);
  const phone =
    /iPhone/.test(ua) && (installed || /Safari\//.test(ua)) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return { phone, supported, installed };
}

/** Installation education is device-wide and contains no account/session data. */
export function HomeScreenGuide({
  received = false,
  manual = false,
}: {
  received?: boolean;
  manual?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const { phone, supported, installed } = device();
  useEffect(() => {
    if (manual || !phone || installed || !received) return;
    try {
      if (localStorage.getItem(seenKey) === '1') return;
      localStorage.setItem(seenKey, '1');
      setOpen(true);
    } catch {
      // If the once-only marker cannot be saved, keep the manual settings entry.
    }
  }, [manual, phone, installed, received]);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open) {
      if (typeof element.showModal === 'function') element.showModal();
      else element.setAttribute('open', '');
    } else {
      if (typeof element.close === 'function') element.close();
      else element.removeAttribute('open');
    }
  }, [open]);
  if (!phone) return null;
  return (
    <>
      {manual && (
        <button className="panel full" onClick={() => setOpen(true)}>
          添加到主屏幕
        </button>
      )}
      <dialog
        ref={dialog}
        className="home-screen-guide"
        role="dialog"
        aria-modal={
          typeof HTMLDialogElement !== 'undefined' &&
          typeof HTMLDialogElement.prototype.showModal === 'function'
            ? true
            : undefined
        }
        aria-labelledby="home-screen-title"
        onClose={() => setOpen(false)}
      >
        <h2 id="home-screen-title">
          {!supported
            ? '消息提醒说明'
            : installed
              ? '主屏幕与消息提醒'
              : '添加到主屏幕，才能收到 TA 的消息提醒'}
        </h2>
        {!supported ? (
          <p>当前系统版本收不到推送，消息会在打开微伴时显示</p>
        ) : installed ? (
          <p>你已从主屏幕打开微伴，可在新消息通知中开启提醒。</p>
        ) : (
          <>
            <ol className="home-screen-steps">
              <li>
                <Share size={24} aria-hidden="true" />
                <span>点 Safari 底部的「分享」按钮</span>
              </li>
              <li>
                <PlusSquare size={24} aria-hidden="true" />
                <span>选「添加到主屏幕」</span>
              </li>
              <li>
                <House size={24} aria-hidden="true" />
                <span>从主屏幕打开微伴</span>
              </li>
            </ol>
            <div
              className="safari-illustration"
              role="img"
              aria-label="Safari 底部工具栏示意：中间的向上箭头是分享按钮"
            >
              <span>‹</span>
              <span>›</span>
              <span className="safari-share">
                <Share size={28} />
                分享
              </span>
              <span>书签</span>
              <span>标签页</span>
            </div>
            <p className="hint">添加后，从主屏幕打开微伴，再到设置中开启此设备通知。</p>
          </>
        )}
        <button className="primary full" onClick={() => setOpen(false)}>
          知道了
        </button>
      </dialog>
    </>
  );
}
