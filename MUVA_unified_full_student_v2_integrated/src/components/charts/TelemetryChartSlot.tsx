import * as echarts from 'echarts';
import type { EChartsOption } from 'echarts';
import { useEffect, useRef } from 'react';

import styles from './TelemetryChartSlot.module.css';

interface TelemetryChartSlotProps {
  title: string;
  metric: string;
  option: EChartsOption;
}

export function TelemetryChartSlot({ title, metric, option }: TelemetryChartSlotProps) {
  const chartElementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const chartElement = chartElementRef.current;

    if (!chartElement) {
      return undefined;
    }

    const chart = echarts.init(chartElement, undefined, { renderer: 'svg' });
    chart.setOption(option);

    const resizeObserver = new ResizeObserver(() => chart.resize());
    resizeObserver.observe(chartElement);

    return () => {
      resizeObserver.disconnect();
      chart.dispose();
    };
  }, [option]);

  return (
    <div className={styles.chartSlot}>
      <header>
        <span>{title}</span>
        <strong>{metric}</strong>
      </header>
      <div className={styles.chart} ref={chartElementRef} aria-label={`${title}实时数据图表`} />
    </div>
  );
}
