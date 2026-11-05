import { useState } from 'react';
import { MenuRow } from './shell-kit.js';
import { Dialog } from './toast.js';
import { checkMicrophone, microphoneProblem, type MicrophoneProblem } from './microphone.js';

export function MicrophoneSettingsRow() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<MicrophoneProblem | null>(null);
  const [allowed, setAllowed] = useState(false);
  async function request() {
    if (pending) return;
    setPending(true);
    try {
      await checkMicrophone();
      setAllowed(true);
      setResult({
        title: '麦克风可以使用',
        message: '已检查并关闭测试录音。现在可以回聊天发语音；浏览器已允许时，不会每次都弹授权框。',
      });
    } catch (error) {
      setAllowed(false);
      setResult(microphoneProblem(error));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <MenuRow
        label="麦克风权限"
        value={pending ? '请完成浏览器授权' : '检查或授权'}
        onClick={() => void request()}
      />
      {result && (
        <Dialog
          title={result.title}
          actions={[
            { label: '知道了', onClick: () => setResult(null) },
            ...(!allowed
              ? [
                  {
                    label: '重新尝试',
                    tone: 'primary' as const,
                    busy: pending,
                    onClick: () => void request(),
                  },
                ]
              : []),
          ]}
        >
          <p className="hint">{result.message}</p>
        </Dialog>
      )}
    </>
  );
}
