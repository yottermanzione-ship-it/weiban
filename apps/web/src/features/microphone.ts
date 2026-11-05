/** Permission requests stay in the explicit click/pointer call stack; never gate on onboarding. */
export interface MicrophoneProblem {
  title: string;
  message: string;
}

export function microphoneProblem(error: unknown): MicrophoneProblem {
  const name = error && typeof error === 'object' && 'name' in error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError')
    return {
      title: '麦克风尚未获准使用',
      message:
        '浏览器没有允许这次录音。苹果浏览器请打开地址栏的网站菜单，在网站设置中把麦克风改为“询问”或“允许”，再回来重试；也可检查手机设置里的浏览器麦克风权限。更新网页不会重置已拒绝的权限。',
    };
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError')
    return { title: '没有找到麦克风', message: '请检查手机或耳机的麦克风是否可用，再重新尝试。' };
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError')
    return {
      title: '麦克风暂时无法使用',
      message: '麦克风可能被其他通话或录音占用。请结束占用它的应用，再回到这里重试。',
    };
  if (name === 'NotSupportedError')
    return {
      title: '当前浏览器不支持录音',
      message: '请使用最新版系统浏览器，从微伴的安全网址打开后重试。',
    };
  return {
    title: '录音没有启动',
    message: '请重新尝试；仍不能录音时，刷新网页并检查手机麦克风是否可用。',
  };
}

export async function openMicrophone(
  audio: boolean | MediaTrackConstraints = true,
): Promise<MediaStream> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
    throw new DOMException('Microphone unavailable', 'NotSupportedError');
  return navigator.mediaDevices.getUserMedia({ audio });
}

/** Check access without leaving an active recording track behind. */
export async function checkMicrophone(): Promise<void> {
  const stream = await openMicrophone();
  stream.getTracks().forEach((track) => track.stop());
}
