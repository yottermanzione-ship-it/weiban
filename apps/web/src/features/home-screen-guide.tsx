import { useEffect, useRef, useState } from 'react';
import { MenuGroup, MenuRow } from './shell-kit.js';

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
  if (!phone && !manual) return null;
  return (
    <>
      {manual && (
        <MenuGroup>
          <MenuRow label="添加到主屏幕" onClick={() => setOpen(true)} />
        </MenuGroup>
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
          {!phone
            ? '添加到主屏幕'
            : !supported
              ? '消息提醒说明'
              : installed
                ? '主屏幕与消息提醒'
                : '添加到主屏幕，才能收到 TA 的消息提醒'}
        </h2>
        {phone && !supported ? (
          <p>当前系统版本收不到推送，消息会在打开微伴时显示</p>
        ) : installed ? (
          <p>你已从主屏幕打开微伴，可在新消息通知中开启提醒。</p>
        ) : (
          <>
            <p>请在 iPhone 的 Safari 中打开微伴，按下面的步骤操作。</p>
            <ol className="home-screen-steps">
              {[
                '点 Safari 的「···」菜单',
                '点「分享」',
                '在分享菜单中向下滑动',
                '找不到时，点「更多 / 编辑操作」',
                '选择「添加到主屏幕」',
              ].map((step, i) => (
                <li key={step} style={{ display: 'block' }}>
                  <SafariStep step={i} />
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <p className="hint">如果能直接看到分享按钮，就从分享按钮开始。</p>
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

/** 原生SVG操作示意，不模拟系统截图。 */
function SafariStep({ step }: { step: number }) {
  const titles = ['···', '分享', '向下滑动', '更多 / 编辑操作', '添加到主屏幕'];
  return (
    <svg
      viewBox="0 0 280 72"
      width="100%"
      role="img"
      aria-label={titles[step] + '操作示意'}
      style={{ display: 'block', maxWidth: 280, margin: '8px 0' }}
    >
      <rect
        x="2"
        y="2"
        width="276"
        height="68"
        rx="12"
        fill="var(--bg-page, #f2f2f7)"
        stroke="var(--line, #bbb)"
      />
      {step === 0 ? (
        <text x="140" y="45" textAnchor="middle" fill="var(--ink, #222)" fontSize="32">
          ···
        </text>
      ) : step === 1 ? (
        <path
          d="M128 32v21h24V32 M140 42V16 M131 25l9-9 9 9"
          fill="none"
          stroke="#1677cc"
          strokeWidth="3"
        />
      ) : step === 2 ? (
        <path d="M140 16v37 M128 41l12 12 12-12" stroke="#1677cc" fill="none" strokeWidth="3" />
      ) : (
        <text x="140" y="42" textAnchor="middle" fill="#1677cc" fontSize="18">
          {titles[step]}
        </text>
      )}
    </svg>
  );
}
