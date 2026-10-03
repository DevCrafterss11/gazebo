import type { EChartsOption } from 'echarts';
import { ChartNoAxesCombined } from 'lucide-react';
import { useMemo } from 'react';

import { TelemetryChartSlot } from '../../../../components/charts/TelemetryChartSlot';
import { PanelShell } from '../../../../components/common/PanelShell/PanelShell';
import { useTelemetryStore } from '../../../../stores/telemetryStore';
import styles from './Panels.module.css';

const palette = {
  cyan: '#16baff',
  green: '#31dfa9',
  yellow: '#f6c445',
  violet: '#ba55f4',
  blue: '#3b91ff',
} as const;

interface ChartDefinition {
  title: string;
  metric: string;
  option: EChartsOption;
}

const createLineOption = (
  labels: string[],
  series: Array<{ name: string; color: string; data: number[] }>,
): EChartsOption => ({
  animation: false,
  color: series.map(({ color }) => color),
  grid: { top: series.length > 1 ? 21 : 5, right: 4, bottom: 16, left: 26 },
  legend: series.length > 1
    ? {
        top: 0,
        right: 0,
        itemWidth: 7,
        itemHeight: 4,
        textStyle: { color: '#7ea6c5', fontSize: 7 },
      }
    : undefined,
  tooltip: { trigger: 'axis' },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: labels,
    axisLine: { lineStyle: { color: '#244e70' } },
    axisTick: { show: false },
    axisLabel: { color: '#6384a0', fontSize: 7, interval: 7, hideOverlap: true },
  },
  yAxis: {
    type: 'value',
    scale: true,
    splitNumber: 2,
    axisLabel: { color: '#6384a0', fontSize: 7 },
    splitLine: { lineStyle: { color: 'rgba(39, 91, 127, 0.35)' } },
  },
  series: series.map(({ name, data }) => ({
    name,
    type: 'line',
    symbol: 'none',
    smooth: 0.22,
    lineStyle: { width: 1.5 },
    data,
  })),
});

export function TelemetryCharts() {
  const samples = useTelemetryStore((state) => state.samples);

  const charts = useMemo<ChartDefinition[]>(() => {
    const latest = samples.at(-1);
    const labels = samples.map((sample) =>
      new Date(sample.timestamp).toLocaleTimeString('zh-CN', {
        minute: '2-digit',
        second: '2-digit',
      }),
    );

    return [
      {
        title: '高度 (m)',
        metric: latest?.position.altitude.toFixed(1) ?? '--',
        option: createLineOption(labels, [
          { name: '高度', color: palette.cyan, data: samples.map((sample) => sample.position.altitude) },
        ]),
      },
      {
        title: '速度 (m/s)',
        metric: latest?.speedMetersPerSecond.toFixed(1) ?? '--',
        option: createLineOption(labels, [
          { name: '速度', color: palette.green, data: samples.map((sample) => sample.speedMetersPerSecond) },
        ]),
      },
      {
        title: '姿态角 (°)',
        metric: 'R / P / Y',
        option: createLineOption(labels, [
          { name: 'Roll', color: palette.cyan, data: samples.map((sample) => sample.attitude.roll) },
          { name: 'Pitch', color: palette.yellow, data: samples.map((sample) => sample.attitude.pitch) },
          { name: 'Yaw', color: palette.green, data: samples.map((sample) => sample.attitude.yaw) },
        ]),
      },
      {
        title: '电池电量 (%)',
        metric: `${latest?.batteryPercent.toFixed(0) ?? '--'}%`,
        option: createLineOption(labels, [
          { name: '电量', color: palette.yellow, data: samples.map((sample) => sample.batteryPercent) },
        ]),
      },
      {
        title: 'GPS 卫星数',
        metric: `${latest?.gpsSatellites ?? '--'}`,
        option: createLineOption(labels, [
          { name: 'GPS', color: palette.violet, data: samples.map((sample) => sample.gpsSatellites) },
        ]),
      },
    ];
  }, [samples]);

  return (
        <PanelShell title="实时遥测数据" icon={ChartNoAxesCombined} action={<span>实时推送</span>}>
      <div className={styles.chartGrid}>
        {charts.map(({ title, metric, option }) => (
          <TelemetryChartSlot title={title} metric={metric} option={option} key={title} />
        ))}
      </div>
    </PanelShell>
  );
}
