/** Explicit intent only; a tutorial, self-recording or a refusal must not trigger paid synthesis. */
export function voiceIntent(raw: string): 'request' | 'avoid' | null {
  const text = raw.normalize('NFKC');
  if (
    /(别|不要|不用|不想|不喜欢|不需要|不方便)[^，。！？\n]{0,8}(语音|听你的声音)|语音[^，。！？\n]{0,4}(不要|别发)/u.test(
      text,
    )
  )
    return 'avoid';
  if (
    /(怎么|如何|教我)[^，。！？\n]{0,6}(发|录|用)[^，。！？\n]{0,4}语音|(?<!给|为|替|帮)我(要|想|会|可以|能|能不能|该|应该)?(给你)?(发|录|用)(送)?(一|几)?[条句段个]?语音/u.test(
      text,
    )
  )
    return null;
  return /(发|来)(送)?(一|几)?[条句段个]?语音|语音(给我|发我|说|讲|回复)|听听你的声音|想听你(的)?声音|用语音/u.test(
    text,
  )
    ? 'request'
    : null;
}
