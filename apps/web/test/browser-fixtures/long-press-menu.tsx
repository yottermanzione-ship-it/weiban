/**
 * 开发自测：用真实的长按 hook 与菜单遮罩，复现「抬手后菜单被补发的点击关掉」。
 * 组件形状与聊天气泡菜单一致：气泡上长按 → 弹出遮罩菜单 → 遮罩点击关闭。
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useLongPress, useMenuScrim } from '../../src/features/shell-kit.js';
import '../../../../docs/design/tokens.css';
import '../../src/app/styles.css';
import '../../src/app/shell.css';
import '../../src/app/chat-old.css';

function Harness() {
  const [open, setOpen] = useState(false);
  const handlers = useLongPress(() => setOpen(true));
  const scrim = useMenuScrim(() => setOpen(false));
  return (
    <div style={{ padding: 24 }}>
      <div
        className="wx-msg-bubble"
        data-testid="bubble"
        style={{ background: '#95ec69', padding: 12, width: 160 }}
        {...handlers}
      >
        长按这条消息
      </div>
      {open && (
        <div className="pop-scrim" data-testid="scrim" {...scrim}>
          <div className="light-menu" role="menu" style={{ left: 40, top: 200 }}>
            <button type="button" role="menuitem" onClick={() => setOpen(false)}>
              复制
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Harness />);
