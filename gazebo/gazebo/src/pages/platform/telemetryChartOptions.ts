import type { EChartsOption } from 'echarts';

import type { TelemetrySample } from '../../types/telemetry';

const baseLineOption = (
  samples: TelemetrySample[],
  series: Array<{ name: string; color: string; values: number[] }>,
): EChartsOption => ({
  animation: false,
  color: series.map((item) => item.color),
  grid: { top: series.length > 1 ? 40 : 20, right: 18, bottom: 28, left: 45 },
  legend: series.length > 1 ? { top: 8, textStyle: { color: '#8fb3cd', fontSize: 9 } } : undefined,
  tooltip: { trigger: 'axis' },
  xAxis: {
    type: 'category',
    boundaryGap: false,
    data: samples.map((sample) => new Date(sample.timestamp).toLocaleTimeString('zh-CN', { minute: '2-digit', second: '2-digit' })),
    axisLabel: { color: '#668ca8', fontSize: 8, hideOverlap: true },
    axisLine: { lineStyle: { color: '#26516f' } },
  },
  yAxis: {
    type: 'value',
    scale: true,
    axisLabel: { color: '#668ca8', fontSize: 8 },
    splitLine: { lineStyle: { color: 'rgba(40, 91, 126, 0.32)' } },
  },
  series: series.map((item) => ({
    name: item.name,
    type: 'line',
    showSymbol: false,
    smooth: 0.2,
    lineStyle: { width: 2 },
    data: item.values,
  })),
});

export const createTelemetryChartOptions = (samples: TelemetrySample[]) => ({
  altitude: baseLineOption(samples, [{ name: '高度', color: '#20c3ff', values: samples.map((sample) => sample.position.altitude) }]),
  speed: baseLineOption(samples, [{ name: '速度', color: '#3be0ae', values: samples.map((sample) => sample.speedMetersPerSecond) }]),
  attitude: baseLineOption(samples, [
    { name: 'Roll', color: '#20c3ff', values: samples.map((sample) => sample.attitude.roll) },
    { name: 'Pitch', color: '#ffc246', values: samples.map((sample) => sample.attitude.pitch) },
    { name: 'Yaw', color: '#c474ff', values: samples.map((sample) => sample.attitude.yaw) },
  ]),
  battery: baseLineOption(samples, [{ name: 'Battery', color: '#ffc246', values: samples.map((sample) => sample.batteryPercent) }]),
  gps: baseLineOption(samples, [{ name: 'GPS', color: '#c474ff', values: samples.map((sample) => sample.gpsSatellites) }]),
  trajectory: {
    animation: false,
    grid: { top: 20, right: 22, bottom: 34, left: 45 },
    tooltip: { trigger: 'item' },
    xAxis: { type: 'value', name: 'East (m)', nameTextStyle: { color: '#668ca8' }, axisLabel: { color: '#668ca8' }, splitLine: { lineStyle: { color: 'rgba(40, 91, 126, 0.32)' } } },
    yAxis: { type: 'value', name: 'North (m)', nameTextStyle: { color: '#668ca8' }, axisLabel: { color: '#668ca8' }, splitLine: { lineStyle: { color: 'rgba(40, 91, 126, 0.32)' } } },
    series: [{ type: 'line', showSymbol: false, lineStyle: { color: '#32d6ff', width: 2 }, data: samples.map((sample) => [sample.east ?? 0, sample.north ?? 0]) }],
  } satisfies EChartsOption,
});
