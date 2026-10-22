import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTemplate, parseConfigJson, validateConfig } from '../src/domain/customSecurity/config';
import { runCustomSecurityEngine } from '../src/domain/customSecurity/engine';
import { fixedAssessmentConfig } from '../src/domain/customSecurity/config';
import { MockCustomSecurityService } from '../src/services/mock/MockCustomSecurityService';

test('custom security engine is deterministic and sends identical streams to both branches', () => {
  const config = createTemplate('combined');
  const first = runCustomSecurityEngine(config, 'run-a');
  const second = runCustomSecurityEngine(config, 'run-b');
  assert.equal(first.inputDigest, second.inputDigest);
  assert.equal(first.inputIds.control.length, second.inputIds.control.length);
  assert.equal(first.inputIds.strategy.length, second.inputIds.strategy.length);
  assert.equal(first.inputIds.control.length, first.inputIds.strategy.length);
  assert.deepEqual(first.observations.map((item) => ({ sequence: item.frame.sequence, receivedAtMs: item.frame.receivedAtMs, detected: item.detected, accepted: item.accepted })), second.observations.map((item) => ({ sequence: item.frame.sequence, receivedAtMs: item.frame.receivedAtMs, detected: item.detected, accepted: item.accepted })));
  assert.ok(first.observations.some((item) => item.truthAnomalous));
  assert.ok(first.evidence.length > 0);
});

test('configuration validation rejects overlapping same-type events and missing replay history', () => {
  const config = createTemplate('single');
  config.scenario.events.push({ ...config.scenario.events[0]!, id: 'replay-2', startSec: 20 });
  assert.ok(validateConfig(config).some((issue) => issue.message.includes('同一种事件不能时间重叠')));
  config.scenario.events[0]!.lookbackSec = 99;
  assert.ok(validateConfig(config).some((issue) => issue.message.includes('重放必须具有足够')));
});

test('configuration import is strict and only creates a validated draft', () => {
  const config = createTemplate('single');
  const imported = parseConfigJson(JSON.stringify(config));
  assert.deepEqual(imported, config);
  assert.throws(() => parseConfigJson(JSON.stringify({ ...config, unexpected: true })), /存在未知字段或缺少字段/);
});

test('assessment uses a frozen test set and aborted reports have no score', async () => {
  const draft = createTemplate('combined');
  const fixed = fixedAssessmentConfig(draft);
  assert.equal(fixed.mode, 'assessment');
  assert.equal(fixed.scenario.id, 'fixed-test-set.v1');
  const service = new MockCustomSecurityService();
  let latest = null;
  const run = await service.createRun(draft, (next) => { latest = next; });
  assert.equal(run.status, 'running');
  const report = await service.abort(run.runId, '用户停止');
  assert.equal(report.status, 'aborted');
  assert.equal(report.score, null);
  assert.equal(latest?.status, 'aborted');
  assert.ok(report.result.observations.length <= 1);
});
