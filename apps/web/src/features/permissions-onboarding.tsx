import { useCallback, useEffect, useRef, useState } from 'react';
import { HomeScreenGuide, iosDeviceInfo } from './home-screen-guide.js';
import { subscribeWebPush } from '../notifications/client.js';
import { openMicrophone } from './microphone.js';
import { isAndroidShell } from '../data/shell-files.js';
import { Dialog } from './toast.js';
import {
  PermissionFlow,
  plannedSteps,
  type PermissionStatus,
  type PermissionStep,
  type StepOutcome,
} from './permission-steps.js';

/**
 * 首次进入申请通知、麦克风权限（2026-10-31 晓楠定一次全要；2026-11-03 总经理改为逐个申请）。
 *
 * - 只在用户登录后首次进入、且有用户手势（首次点进）时开始；绝不在页面加载时自动弹。
 * - 逐个申请（permission-steps.ts）：第一步只申请通知，等结果回来；第二步再申请麦克风。每一步都先显示
 *   我们自己的说明框，用户点一次「开启」才发这一项的系统申请（Safari 要求每次系统申请都在用户点击里发起，
 *   所以绝不在一次点击里连续发两个申请）。被拒绝、关掉或浏览器不支持时照常进入下一步；已授权的跳过。
 * - 本机 localStorage 记 `permissions-onboarded`（设备级、无账号数据），全部步骤走完后不再触发；
 *   被拒的单项记各自的 denial 键，下次用到时由现有提示复用，不另设二次弹窗。
 * - iPhone 矩阵（复用 home-screen-guide 的判断与文案）：未加主屏幕跳过通知、走完后打开现有加主屏幕引导；
 *   系统 <16.4 跳过通知。
 * - VAPID 未配置时：通知权限照做，订阅一步抛错即跳过（不新建 push 基建）。
 * - 新手引导（guided-tour）正在高亮时不开始，避免说明框把引导打断；引导结束后的下一次点击再开始。
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
interface Plan {
  notification: NotificationPlan;
  status: Record<PermissionStep, PermissionStatus>;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: number | undefined;
  return Promise.race([
    promise.finally(() => {
      if (timer !== undefined) window.clearTimeout(timer);
    }),
    new Promise<T>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error('超时')), ms);
    }),
  ]);
}

function notificationStatus(plan: NotificationPlan): PermissionStatus {
  if (plan !== 'prompt') return 'unsupported';
  const permission = Notification.permission;
  if (permission === 'granted') return 'granted';
  if (permission === 'denied') return 'denied';
  return 'prompt';
}

async function microphoneStatus(): Promise<PermissionStatus> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia)
    return 'unsupported';
  try {
    const result = await withTimeout(navigator.permissions.query({ name: 'microphone' }), 1500);
    if (result.state === 'granted') return 'granted';
    if (result.state === 'denied') return 'denied';
  } catch {
    // 旧版 Safari / Firefox 不认识 microphone 查询：按需要申请处理。
  }
  return 'prompt';
}

async function readPlan(): Promise<Plan> {
  const { phone, supported, installed } = iosDeviceInfo();
  let notification: NotificationPlan = 'prompt';
  if (isAndroidShell() || !('Notification' in window)) notification = 'unsupported';
  else if (phone && !supported) notification = 'skip-old-ios';
  else if (phone && supported && !installed) notification = 'skip-uninstalled';
  return {
    notification,
    status: {
      notification: notificationStatus(notification),
      microphone: await microphoneStatus(),
    },
  };
}

/** 只发通知这一项的系统申请（兼容旧版回调式 requestPermission）。 */
function requestNotification(): Promise<StepOutcome> {
  return new Promise<NotificationPermission>((resolve) => {
    const result = Notification.requestPermission(resolve);
    if (result) void result.then(resolve, () => resolve('default'));
  }).then((permission) => {
    if (permission !== 'granted') {
      writeMarker(DENIED_NOTIFICATION_KEY);
      return permission === 'denied' ? 'denied' : 'dismissed';
    }
    clearMarker(DENIED_NOTIFICATION_KEY);
    // 订阅不需要再次手势，也不挡下一步：VAPID 未配置时取公钥即抛错，只记通知已授权；
    // 订阅失败不弹错、不重试，下次进入时 resumeExistingPush 只重绑已有订阅。
    void withTimeout(subscribeWebPush(), 10_000).catch(() => {});
    return 'granted';
  });
}

/** 只发麦克风这一项的系统申请：拿到流后立即 stop，不录音。 */
async function requestMicrophone(): Promise<StepOutcome> {
  try {
    const stream = await openMicrophone();
    stream.getTracks().forEach((track) => track.stop());
    clearMarker(DENIED_MICROPHONE_KEY);
    return 'granted';
  } catch {
    writeMarker(DENIED_MICROPHONE_KEY);
    return 'denied';
  }
}

function requestStep(step: PermissionStep): Promise<StepOutcome> {
  return step === 'notification' ? requestNotification() : requestMicrophone();
}

const COPY: Record<PermissionStep, { title: string; body: string; action: string }> = {
  notification: {
    title: '开启消息通知',
    body: 'TA 给你发消息时，用通知提醒你。之后可以在设置里随时更改。',
    action: '开启通知',
  },
  microphone: {
    title: '开启麦克风',
    body: '用来发语音和与 TA 通话，只在你用到这些功能时才会使用。之后可以在设置里随时更改。',
    action: '开启麦克风',
  },
};

type Stage = 'armed' | 'checking' | 'step' | 'requesting' | 'guide' | 'done';

export function PermissionsOnboarding() {
  const [stage, setStage] = useState<Stage>(() => (readMarker(DONE_KEY) ? 'done' : 'armed'));
  const [step, setStep] = useState<PermissionStep | null>(null);
  const flow = useRef<PermissionFlow | null>(null);
  const plan = useRef<Plan | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  /** 一步有结果（或被跳过）后：还有下一步就显示它的说明框，否则收尾。 */
  const next = useCallback(() => {
    if (!alive.current) return;
    const current = flow.current;
    if (!current || current.done) {
      writeMarker(DONE_KEY);
      setStep(null);
      setStage(plan.current?.notification === 'skip-uninstalled' ? 'guide' : 'done');
      return;
    }
    setStep(current.current);
    setStage('step');
  }, []);

  useEffect(() => {
    if (stage !== 'armed') return;
    const arm = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof PointerEvent && event.button !== 0) return;
      if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return;
      if (document.querySelector('.guided-tour-layer')) return;
      setStage('checking');
      // 查状态不发系统申请；系统申请只在说明框的按钮点击里发起。
      void readPlan()
        .then((value) => {
          plan.current = value;
          flow.current = new PermissionFlow(plannedSteps(value.status), requestStep);
          next();
        })
        .catch(() => {
          // 查不了状态（极少见）：本次不打扰，不记 done，下次启动再试。
          if (alive.current) setStage('done');
        });
    };
    document.addEventListener('pointerdown', arm, true);
    document.addEventListener('keydown', arm, true);
    return () => {
      document.removeEventListener('pointerdown', arm, true);
      document.removeEventListener('keydown', arm, true);
    };
  }, [stage, next]);

  if (stage === 'guide') return <HomeScreenGuide received />;
  if (stage !== 'step' || !step || !flow.current) return null;

  const current = flow.current;
  const confirm = () => {
    // 系统申请在本次点击的同步调用链内发出（confirm 里立即调用 request）；结果回来前不显示下一步。
    const pending = current.confirm();
    setStage('requesting');
    // null = 上一次申请还没结果（重复点击）：由那一次的结果推进，这里不动。
    void pending.then((result) => {
      if (result) next();
    });
  };
  const skip = () => {
    current.skip();
    next();
  };
  const dismiss = () => {
    // Esc / 点蒙层 = 本次没决定：不记 done，下次首次点进时从还没有结果的那一步重新开始。
    setStep(null);
    setStage('armed');
  };
  const copy = COPY[step];

  return (
    <Dialog
      title={copy.title}
      onDismiss={dismiss}
      actions={[
        { label: copy.action, tone: 'primary', onClick: confirm },
        { label: '暂不开启', onClick: skip },
      ]}
    >
      {current.steps.length > 1 && (
        <p className="hint">
          第 {current.position} 步，共 {current.steps.length} 步
        </p>
      )}
      <p>{copy.body}</p>
      {step === 'microphone' && plan.current?.notification === 'skip-uninstalled' && (
        <p>添加到主屏幕，才能收到 TA 的消息提醒。稍后会为你打开添加主屏幕的说明。</p>
      )}
      {step === 'microphone' && plan.current?.notification === 'skip-old-ios' && (
        <p>当前系统版本收不到推送，消息会在打开微伴时显示。</p>
      )}
    </Dialog>
  );
}
