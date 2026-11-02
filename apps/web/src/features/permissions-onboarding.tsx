import { useEffect, useRef, useState } from 'react';
import { HomeScreenGuide, iosDeviceInfo } from './home-screen-guide.js';
import { subscribeWebPush } from '../notifications/client.js';
import { Dialog } from './toast.js';

/**
 * 首次进入一次性申请通知 + 麦克风权限（2026-10-31 晓楠定：已知比旧版激进，坚持一次全要）。
 *
 * - 只在用户登录后首次进入、且有用户手势（首次点进）时触发一次；绝不在页面加载时自动弹。
 * - 本机 localStorage 记 `permissions-onboarded`（设备级、无账号数据），流程跑完或用户选
 *   “以后再说”后不再触发；被拒的单项记各自的 denial 键，下次用到时由现有提示复用，不另设二次弹窗。
 * - 顺序：先通知（系统框），再麦克风探针（拿到流后立即 stop，不录音）；两框之间给一句本机说明。
 * - iPhone 矩阵（复用 home-screen-guide 的判断与文案）：未加主屏幕跳过通知、走完麦克风后
 *   打开现有加主屏幕引导；系统 <16.4 跳过通知。
 * - VAPID 未配置时：通知权限照做，订阅一步抛错即跳过（不新建 push 基建）。
 */
const DONE_KEY = 'permissions-onboarded';
const DENIED_NOTIFICATION_KEY = 'permissions-denied:notification';
const DENIED_MICROPHONE_KEY = 'permissions-denied:microphone';

function readMarker(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function writeMarker(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // 标记存不下时流程仍可跑完；下次进入会再次触发一次，不阻塞主流程。
  }
}
function clearMarker(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 删不掉也不阻塞。
  }
}

type NotificationPlan = 'prompt' | 'skip-uninstalled' | 'skip-old-ios' | 'unsupported';
type MicrophonePlan = 'prompt' | 'unsupported';
interface Plan {
  notification: NotificationPlan;
  microphone: MicrophonePlan;
}
function computePlan(): Plan {
  const { phone, supported, installed } = iosDeviceInfo();
  let notification: NotificationPlan = 'prompt';
  if (!('Notification' in window)) notification = 'unsupported';
  else if (phone && !supported) notification = 'skip-old-ios';
  else if (phone && supported && !installed) notification = 'skip-uninstalled';
  const microphone: MicrophonePlan =
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
      ? 'prompt'
      : 'unsupported';
  return { notification, microphone };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: number | undefined;
  return Promise.race([
    promise.finally(() => {
      if (timer !== undefined) window.clearTimeout(timer);
    }),
    new Promise<T>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error('订阅超时')), ms);
    }),
  ]);
}

async function runFlow(plan: Plan): Promise<void> {
  if (plan.notification === 'prompt') {
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      clearMarker(DENIED_NOTIFICATION_KEY);
      try {
        // VAPID 未配置时取公钥即抛错：只记通知已授权，跳过订阅，不阻塞麦克风一步。
        await withTimeout(subscribeWebPush(), 10_000);
      } catch {
        // 订阅失败不弹错、不重试；下次进入时 resumeExistingPush 只重绑已有订阅。
      }
    } else {
      writeMarker(DENIED_NOTIFICATION_KEY);
    }
  }
  if (plan.microphone === 'prompt') {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      clearMarker(DENIED_MICROPHONE_KEY);
    } catch {
      writeMarker(DENIED_MICROPHONE_KEY);
    }
  }
}

type Stage = 'armed' | 'explain' | 'running' | 'guide' | 'done';

export function PermissionsOnboarding() {
  const [stage, setStage] = useState<Stage>(() => (readMarker(DONE_KEY) ? 'done' : 'armed'));
  const [plan, setPlan] = useState<Plan | null>(null);
  const runningRef = useRef(false);

  useEffect(() => {
    if (stage !== 'armed') return;
    const arm = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof PointerEvent && event.button !== 0) return;
      if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return;
      setPlan(computePlan());
      setStage('explain');
    };
    document.addEventListener('pointerdown', arm, true);
    document.addEventListener('keydown', arm, true);
    return () => {
      document.removeEventListener('pointerdown', arm, true);
      document.removeEventListener('keydown', arm, true);
    };
  }, [stage]);

  if (stage === 'done' || stage === 'running') return null;
  if (stage === 'guide') return <HomeScreenGuide received />;

  const start = () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setStage('running');
    const current = plan ?? computePlan();
    // requestPermission 在本次点击的同步调用链内发出（手势锚点内）；跑完后统一记 done。
    void runFlow(current)
      .catch(() => {})
      .finally(() => {
        writeMarker(DONE_KEY);
        if (current.notification === 'skip-uninstalled') setStage('guide');
        else setStage('done');
      });
  };
  const later = () => {
    writeMarker(DONE_KEY);
    setStage('done');
  };
  const dismiss = () => {
    // Esc / 点蒙层 = 本次没决定：不记 done，下次首次点进时重新触发。
    setStage('armed');
  };

  return (
    <Dialog
      title="开启通知和麦克风"
      onDismiss={dismiss}
      actions={[
        { label: '开始设置', tone: 'primary', onClick: start },
        { label: '以后再说', onClick: later },
      ]}
    >
      <p>通知用来提醒你 TA 的消息，麦克风用来语音和通话；都可以在设置里再改。</p>
      {plan?.notification === 'skip-uninstalled' && (
        <p>添加到主屏幕，才能收到 TA 的消息提醒。稍后会为你打开添加主屏幕的说明。</p>
      )}
      {plan?.notification === 'skip-old-ios' && (
        <p>当前系统版本收不到推送，消息会在打开微伴时显示。</p>
      )}
    </Dialog>
  );
}
