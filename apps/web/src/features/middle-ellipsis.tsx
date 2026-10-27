/*
 * 长文件名中间省略、保留后缀（26 号 §5；2026-10-27 批 U5）：
 * 「和林夏的微信聊天记录导出…备份副本.txt」——前半段放不下时省略号落在中间，最后几个字和扩展名始终看得见。
 * 纯样式实现（前半段 text-overflow: ellipsis，后半段不收缩），宽度变了自动适应，不用量字宽。
 */
const TAIL = 6;

export function splitFileName(name: string): [head: string, tail: string] {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : '';
  const stem = ext ? name.slice(0, -ext.length) : name;
  if (stem.length <= TAIL + 2) return [name, ''];
  return [stem.slice(0, -TAIL), stem.slice(-TAIL) + ext];
}

export function MiddleEllipsis({ text, className }: { text: string; className?: string }) {
  const [head, tail] = splitFileName(text);
  return (
    <span className={`middle-ellipsis ${className ?? ''}`} title={text}>
      <span className="middle-ellipsis-head">{head}</span>
      {tail && <span className="middle-ellipsis-tail">{tail}</span>}
    </span>
  );
}
