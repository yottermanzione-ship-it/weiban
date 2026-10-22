import { Tooltip } from 'antd';

/** 近 7 天柱状趋势：最后一天用品牌色，其余淡色。 */
export function TrendBars({
  labels,
  values,
  format,
  color = '#07C160',
  height = 120,
}: {
  labels: string[];
  values: number[];
  format: (value: number) => string;
  color?: string;
  height?: number;
}) {
  const max = Math.max(...values, 1);
  return (
    <div className="trend">
      <div className="trend-bars" style={{ height }}>
        {values.map((value, index) => {
          const ratio = max === 0 ? 0 : value / max;
          const isLast = index === values.length - 1;
          return (
            <Tooltip
              key={`${labels[index]}-${index}`}
              title={`${labels[index] ?? ''}：${format(value)}`}
            >
              <div className="trend-col">
                <span className="trend-value">{value > 0 ? format(value) : ''}</span>
                <div
                  className="trend-bar"
                  style={{
                    height: `${Math.max(ratio * 100, value > 0 ? 4 : 1)}%`,
                    background: isLast ? color : `${color}45`,
                  }}
                />
              </div>
            </Tooltip>
          );
        })}
      </div>
      <div className="trend-labels">
        {labels.map((label, index) => (
          <span key={`${label}-${index}`} className={index === labels.length - 1 ? 'is-last' : ''}>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
