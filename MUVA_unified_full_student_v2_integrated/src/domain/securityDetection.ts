import type { SecurityEvidence, SecurityTelemetry } from '../types/securityExperiment';

export interface SecurityDetectorState {
  lastSequence: number | null;
  lastReceivedAt: number | null;
  lastConnection: SecurityTelemetry['connection'] | null;
}

export function detectSecurityEvidence(sample: SecurityTelemetry, state: SecurityDetectorState): SecurityEvidence[] {
  const evidence: SecurityEvidence[] = [];
  const reconnect = state.lastConnection === 'interrupted' && sample.connection === 'connected';
  if (!reconnect && state.lastSequence !== null && sample.sequence <= state.lastSequence) {
    evidence.push({ id: `${sample.runId}-${sample.receivedAt}-sequence`, code: sample.sequence === state.lastSequence ? 'duplicate_sequence' : 'sequence_regression', detail: `序列号 ${sample.sequence} 未超过前值 ${state.lastSequence}`, receivedAt: sample.receivedAt, automatic: true });
  }
  if (sample.stale) evidence.push({ id: `${sample.runId}-${sample.receivedAt}-stale`, code: 'stale_data', detail: '数据年龄超过新鲜度阈值，保留最后观测并标记过期', receivedAt: sample.receivedAt, automatic: true });
  if (sample.connection === 'interrupted') evidence.push({ id: `${sample.runId}-${sample.receivedAt}-interrupt`, code: 'connection_interrupted', detail: '当前实验页面的遥测订阅短时中断；不代表飞控失联', receivedAt: sample.receivedAt, automatic: true });
  if (reconnect) evidence.push({ id: `${sample.runId}-${sample.receivedAt}-reconnect`, code: 'recovered', detail: '页面遥测订阅恢复；以新接收帧重新建立序列基准', receivedAt: sample.receivedAt, automatic: true });
  if (state.lastReceivedAt !== null && sample.receivedAt - state.lastReceivedAt > 2500) evidence.push({ id: `${sample.runId}-${sample.receivedAt}-gap`, code: 'receive_gap', detail: `接收间隔 ${sample.receivedAt - state.lastReceivedAt} ms`, receivedAt: sample.receivedAt, automatic: true });
  return evidence;
}
