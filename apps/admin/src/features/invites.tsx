/** 兼容旧书签；不再请求历史邀请码或提供生成入口。 */
export function InvitesPage() {
  return (
    <section className="panel stack">
      <h1>邀请码已停用</h1>
      <p>用户可以直接注册。注册、邀请和充值均不再赠送积分。</p>
      <p className="hint">已有积分与历史账本保留。</p>
    </section>
  );
}
