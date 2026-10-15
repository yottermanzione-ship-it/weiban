/** Nickname is initial identity context, not a permanent instruction or a new naming state. */
export function userNickname(nickname: string | null | undefined): string {
  return nickname?.trim() || '你';
}

export function userNamingContext(nickname: string | null | undefined): string {
  const name = nickname?.trim();
  return `${name ? `用户昵称：${name}；初识时以此称呼` : '用户尚未提供昵称，可以直接称呼“你”'}。后续可自然延续真实对话与记忆中形成的称呼，不必一直照昵称叫，也不要每句话都叫名字。`;
}
