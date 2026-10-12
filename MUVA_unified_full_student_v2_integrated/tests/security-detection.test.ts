import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectSecurityEvidence } from '../src/domain/securityDetection';
import { MockSecurityExperimentService } from '../src/services/mock/MockSecurityExperimentService';
import type { SecurityTelemetry } from '../src/types/securityExperiment';

const sample = (overrides: Partial<SecurityTelemetry> = {}): SecurityTelemetry => ({
  protocolVersion: 'security.telemetry.v1', runId: 'run-1', source: 'simulation', sequence: 12,
  capturedAt: 1000, receivedAt: 1100, elapsedMs: 1000, altitude: 0, speed: 0, battery: 99,
  stale: false, connection: 'connected', ...overrides,
});

test('replay sequence duplicates and regressions produce evidence', () => {
  const first = sample();
  assert.deepEqual(detectSecurityEvidence(sample({ receivedAt: 1200 }), { lastSequence: first.sequence, lastReceivedAt: first.receivedAt, lastConnection: 'connected' }).map((item) => item.code), ['duplicate_sequence']);
  assert.deepEqual(detectSecurityEvidence(sample({ sequence: 8, receivedAt: 1300 }), { lastSequence: 12, lastReceivedAt: 1200, lastConnection: 'connected' }).map((item) => item.code), ['sequence_regression']);
});

test('a normal reconnect establishes a fresh sequence baseline instead of reporting replay', () => {
  const evidence = detectSecurityEvidence(sample({ sequence: 1, receivedAt: 3000 }), { lastSequence: 90, lastReceivedAt: 1500, lastConnection: 'interrupted' });
  assert.deepEqual(evidence.map((item) => item.code), ['recovered']);
});

test('stale samples and long receive gaps are explicit, while current frames are not marked healthy by old values', () => {
  const evidence = detectSecurityEvidence(sample({ stale: true, connection: 'interrupted', receivedAt: 5000 }), { lastSequence: 11, lastReceivedAt: 1000, lastConnection: 'connected' });
  assert.deepEqual(evidence.map((item) => item.code), ['stale_data', 'connection_interrupted', 'receive_gap']);
});

test('a fresh higher sequence after an interruption is a reconnect, not replay', () => {
  const evidence = detectSecurityEvidence(sample({ sequence: 1, receivedAt: 4000 }), { lastSequence: 44, lastReceivedAt: 1000, lastConnection: 'interrupted' });
  assert.deepEqual(evidence.map((item) => item.code), ['recovered', 'receive_gap']);
});

test('mock assessment keeps the answer hidden until the idempotent report is finalized', async () => {
  const service = new MockSecurityExperimentService();
  const run = await service.createRun({ caseId: 'replay', mode: 'assessment', difficulty: 'medium' });
  assert.equal(run.config.caseId, 'hidden');
  assert.equal(run.seed, null);
  const first = await service.abort(run.runId);
  const repeated = await service.abort(run.runId);
  assert.ok(first.config.caseId === 'replay' || first.config.caseId === 'degradation');
  assert.ok(first.seed !== null);
  assert.deepEqual(repeated, first);
  assert.equal((await service.listReports()).length, 1);
});
