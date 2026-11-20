import { useEffect, useRef } from 'react';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { init, use as registerCharts, type EChartsType } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import type { EChartsOption } from 'echarts';

registerCharts([BarChart, LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

export function WeibanChart({
  option,
  label,
  className,
  onItemClick,
}: {
  option: EChartsOption;
  label: string;
  className: string;
  onItemClick?: (index: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType>(null);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const chart = init(element, undefined, { renderer: 'canvas' });
    chartRef.current = chart;
    const resize = new ResizeObserver(() => {
      if (element.clientWidth && element.clientHeight) chart.resize();
    });
    resize.observe(element);
    return () => {
      resize.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onItemClick) return;
    const click = ({ dataIndex }: { dataIndex: number }) => onItemClick(dataIndex);
    chart.on('click', 'series', click);
    return () => {
      chart.off('click', click);
    };
  }, [onItemClick]);

  return <div ref={container} className={className} role="img" aria-label={label} />;
}
