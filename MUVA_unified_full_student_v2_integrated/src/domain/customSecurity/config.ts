import type { CustomSecurityConfig, CustomSecurityEvent, CustomEventType, ValidationIssue } from '../../types/customSecurity';

export const ENGINE_VERSION = 'telemetry-copy-engine.v1';
export const EVENT_NAMES: Record<CustomEventType, string> = { replay: '数据重放', delay: '延迟', loss: '丢包', interruption: '短时中断' };
export const LIMITS = { durationMin: 30, durationMax: 180, eventMax: 12, queueMax: 128, delayMax: 5000, recoveryMin: 8 };

export function createEvent(type: CustomEventType, id: string, startSec = 15): CustomSecurityEvent {
  return { id, type, enabled: true, startSec, durationSec: 10, lookbackSec: 5, delayMs: 2000, jitterMs: 250, lossRate: 0.5, seed: 42 };
}

export function createTemplate(template: 'single' | 'continuous' | 'combined' = 'combined'): CustomSecurityConfig {
  const replay = { ...createEvent('replay', 'event-replay'), durationSec: 15 };
  const events = template === 'single' ? [replay] : template === 'continuous'
    ? [{ ...replay, durationSec: 30 }]
    : [replay, { ...createEvent('delay', 'event-delay', 45), durationSec: 15 }, createEvent('interruption', 'event-interruption', 60)];
  return {
    schemaVersion: 'custom-security.v1', hypothesis: '使用序号与数据年龄识别重放和延迟，在连续新鲜数据到达后恢复接收，同时保留至少 80% 的正常数据。', mode: 'training',
    scenario: { id: `scenario-${template}`, version: 1, source: 'seeded-telemetry-v1', durationSec: 90, baselineSec: 15, recoverySec: 20, seed: 42, frequencyHz: 4, queueCapacity: 128, conflictOrder: 'replay-loss-delay-interruption.v1', queuePolicy: 'discard-on-interruption-and-event-end', events },
    strategy: { id: 'strategy-student', version: 1, age: { enabled: true, threshold: 1500, consecutive: 2, action: 'filter' }, sequence: { enabled: true, threshold: 0, consecutive: 1, action: 'filter' }, gap: { enabled: true, threshold: 1250, consecutive: 2, action: 'filter' }, recovery: { maxAgeMs: 1000, maxGapMs: 750, consecutive: 3 } },
  };
}

export function fixedAssessmentConfig(draft: CustomSecurityConfig): CustomSecurityConfig {
  const config = createTemplate();
  config.mode = 'assessment';
  config.hypothesis = draft.hypothesis;
  config.strategy = structuredClone(draft.strategy);
  config.scenario.id = 'fixed-test-set.v1';
  config.scenario.seed = 20261013;
  config.scenario.durationSec = 120;
  config.scenario.recoverySec = 20;
  config.scenario.events = [
    { ...createEvent('replay', 'test-replay', 15), durationSec: 10 },
    { ...createEvent('delay', 'test-delay', 35), durationSec: 12, delayMs: 2250, jitterMs: 500 },
    { ...createEvent('loss', 'test-loss', 60), durationSec: 8, lossRate: 1, seed: 73 },
    { ...createEvent('interruption', 'test-interruption', 85), durationSec: 10 },
  ];
  return config;
}

export function validateConfig(config: CustomSecurityConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (field: string, message: string): void => { issues.push({ field, message }); };
  const bounded = (value: number, min: number, max: number, field: string, integer = false): void => {
    if (!Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) add(field, `必须为 ${min}–${max}${integer ? ' 的整数' : ''}`);
  };
  if (config.hypothesis.trim().length < 10 || config.hypothesis.length > 1000) add('hypothesis', '请输入 10–1000 字的可验证假设');
  const scenario = config.scenario;
  bounded(scenario.durationSec, LIMITS.durationMin, LIMITS.durationMax, 'scenario.durationSec', true);
  bounded(scenario.baselineSec, 5, 30, 'scenario.baselineSec', true);
  bounded(scenario.recoverySec, LIMITS.recoveryMin, 60, 'scenario.recoverySec', true);
  bounded(scenario.seed, 0, 4294967295, 'scenario.seed', true);
  bounded(scenario.queueCapacity, 1, LIMITS.queueMax, 'scenario.queueCapacity', true);
  if (scenario.baselineSec + scenario.recoverySec >= scenario.durationSec) add('scenario.durationSec', '正常对照和恢复窗口之间必须留出异常区间');
  if (scenario.events.length > LIMITS.eventMax) add('scenario.events', `事件最多 ${LIMITS.eventMax} 个`);
  const eventIds = new Set<string>();
  scenario.events.forEach((event, index) => {
    const path = `scenario.events[${index}]`;
    if (eventIds.has(event.id)) add(`${path}.id`, '事件编号不能重复');
    eventIds.add(event.id);
    bounded(event.startSec, 0, scenario.durationSec, `${path}.startSec`, true);
    bounded(event.durationSec, 1, 90, `${path}.durationSec`, true);
    bounded(event.lookbackSec, 1, 15, `${path}.lookbackSec`, true);
    bounded(event.delayMs, 0, LIMITS.delayMax, `${path}.delayMs`, true);
    bounded(event.jitterMs, 0, 2000, `${path}.jitterMs`, true);
    bounded(event.lossRate, 0, 1, `${path}.lossRate`);
    bounded(event.seed, 0, 4294967295, `${path}.seed`, true);
    if (event.startSec + event.durationSec > scenario.durationSec) add(`${path}.durationSec`, '持续时间越过运行结束');
    if (!event.enabled) return;
    if (event.startSec < scenario.baselineSec) add(`${path}.startSec`, '事件不能进入正常对照区间');
    if (event.startSec + event.durationSec > scenario.durationSec - scenario.recoverySec) add(`${path}.durationSec`, '事件必须在恢复观察窗口之前结束');
    if (event.type === 'replay' && event.lookbackSec > event.startSec) add(`${path}.lookbackSec`, '重放必须具有足够的本次会话历史数据');
    if (event.type === 'delay' && event.delayMs + event.jitterMs > LIMITS.delayMax) add(`${path}.jitterMs`, '延迟量与抖动之和不能超过 5000 ms');
    if (event.type === 'delay' && scenario.queueCapacity < Math.ceil((event.delayMs + event.jitterMs + 25) * 4 / 1000)) add('scenario.queueCapacity', '队列容量不足以容纳最大延迟，请增加容量或降低延迟');
    if (scenario.events.some((other, otherIndex) => otherIndex < index && other.enabled && other.type === event.type && other.startSec < event.startSec + event.durationSec && event.startSec < other.startSec + other.durationSec)) add(`${path}.startSec`, '同一种事件不能时间重叠');
  });
  for (const name of ['age', 'sequence', 'gap'] as const) {
    const rule = config.strategy[name];
    bounded(rule.threshold, name === 'sequence' ? 0 : 1, name === 'sequence' ? 0 : 10000, `strategy.${name}.threshold`, true);
    bounded(rule.consecutive, 1, 10, `strategy.${name}.consecutive`, true);
  }
  bounded(config.strategy.recovery.maxAgeMs, 25, 5000, 'strategy.recovery.maxAgeMs', true);
  bounded(config.strategy.recovery.maxGapMs, 250, 5000, 'strategy.recovery.maxGapMs', true);
  bounded(config.strategy.recovery.consecutive, 1, 10, 'strategy.recovery.consecutive', true);
  const recoveryNeed = Math.ceil(config.strategy.recovery.consecutive / 4) + 2;
  if (scenario.recoverySec < recoveryNeed) add('scenario.recoverySec', `恢复窗口至少需要 ${recoveryNeed} 秒`);
  return issues;
}

function object(value: unknown, keys: string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} 必须是对象`);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(record, key))) throw new Error(`${path} 存在未知字段或缺少字段`);
  return record;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000) throw new Error(`${path} 必须为非空字符串（最多 1000 字）`);
  return value;
}

function numeric(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} 必须为有限数值`);
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} 必须为布尔值`);
  return value;
}

function choice<Choice extends string>(value: unknown, values: readonly Choice[], path: string): Choice {
  if (typeof value !== 'string' || !values.includes(value as Choice)) throw new Error(`${path} 不支持该值`);
  return value as Choice;
}

export function parseConfigJson(json: string): CustomSecurityConfig {
  if (json.length > 50000) throw new Error('配置文件不能超过 50 KB');
  const root = object(JSON.parse(json) as unknown, ['schemaVersion', 'hypothesis', 'mode', 'scenario', 'strategy'], 'config');
  const scenario = object(root.scenario, ['id', 'version', 'source', 'durationSec', 'baselineSec', 'recoverySec', 'seed', 'frequencyHz', 'queueCapacity', 'conflictOrder', 'queuePolicy', 'events'], 'scenario');
  const strategy = object(root.strategy, ['id', 'version', 'age', 'sequence', 'gap', 'recovery'], 'strategy');
  const recovery = object(strategy.recovery, ['maxAgeMs', 'maxGapMs', 'consecutive'], 'strategy.recovery');
  if (!Array.isArray(scenario.events) || scenario.events.length > LIMITS.eventMax) throw new Error('scenario.events 必须为最多 12 个事件的数组');
  const parseRule = (name: string) => {
    const rule = object(strategy[name], ['enabled', 'threshold', 'consecutive', 'action'], `strategy.${name}`);
    return { enabled: boolean(rule.enabled, `${name}.enabled`), threshold: numeric(rule.threshold, `${name}.threshold`), consecutive: numeric(rule.consecutive, `${name}.consecutive`), action: choice(rule.action, ['alert', 'mark', 'filter'] as const, `${name}.action`) };
  };
  const config: CustomSecurityConfig = {
    schemaVersion: choice(root.schemaVersion, ['custom-security.v1'], 'schemaVersion'), hypothesis: text(root.hypothesis, 'hypothesis'), mode: choice(root.mode, ['training', 'assessment'], 'mode'),
    scenario: {
      id: text(scenario.id, 'scenario.id'), version: numeric(scenario.version, 'scenario.version'), source: choice(scenario.source, ['seeded-telemetry-v1'], 'scenario.source'),
      durationSec: numeric(scenario.durationSec, 'durationSec'), baselineSec: numeric(scenario.baselineSec, 'baselineSec'), recoverySec: numeric(scenario.recoverySec, 'recoverySec'), seed: numeric(scenario.seed, 'seed'),
      frequencyHz: numeric(scenario.frequencyHz, 'frequencyHz') as 4, queueCapacity: numeric(scenario.queueCapacity, 'queueCapacity'),
      conflictOrder: choice(scenario.conflictOrder, ['replay-loss-delay-interruption.v1'], 'conflictOrder'), queuePolicy: choice(scenario.queuePolicy, ['discard-on-interruption-and-event-end'], 'queuePolicy'),
      events: scenario.events.map((value: unknown, index: number) => {
        const path = `events[${index}]`;
        const event = object(value, ['id', 'type', 'enabled', 'startSec', 'durationSec', 'lookbackSec', 'delayMs', 'jitterMs', 'lossRate', 'seed'], path);
        return { id: text(event.id, `${path}.id`), type: choice(event.type, ['replay', 'delay', 'loss', 'interruption'], `${path}.type`), enabled: boolean(event.enabled, `${path}.enabled`), startSec: numeric(event.startSec, `${path}.startSec`), durationSec: numeric(event.durationSec, `${path}.durationSec`), lookbackSec: numeric(event.lookbackSec, `${path}.lookbackSec`), delayMs: numeric(event.delayMs, `${path}.delayMs`), jitterMs: numeric(event.jitterMs, `${path}.jitterMs`), lossRate: numeric(event.lossRate, `${path}.lossRate`), seed: numeric(event.seed, `${path}.seed`) };
      }),
    },
    strategy: { id: text(strategy.id, 'strategy.id'), version: numeric(strategy.version, 'strategy.version'), age: parseRule('age'), sequence: parseRule('sequence'), gap: parseRule('gap'), recovery: { maxAgeMs: numeric(recovery.maxAgeMs, 'maxAgeMs'), maxGapMs: numeric(recovery.maxGapMs, 'maxGapMs'), consecutive: numeric(recovery.consecutive, 'consecutive') } },
  };
  if (config.scenario.frequencyHz !== 4) throw new Error('frequencyHz 第一版固定为 4 Hz');
  for (const version of [config.scenario.version, config.strategy.version]) if (!Number.isInteger(version) || version < 1 || version > 1000000) throw new Error('配置版本必须为 1–1000000 的整数');
  const issues = validateConfig(config);
  if (issues.length) throw new Error(issues.map(issue => `${issue.field}: ${issue.message}`).join('；'));
  return config;
}

export function digest(value: unknown): string {
  const canonical = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(canonical).join(',')}]`;
    if (item !== null && typeof item === 'object') return `{${Object.entries(item).sort(([left], [right]) => left.localeCompare(right)).map(([key, content]) => `${JSON.stringify(key)}:${canonical(content)}`).join(',')}}`;
    return JSON.stringify(item) ?? 'null';
  };
  let hash = 2166136261;
  for (const character of canonical(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return `fnv1a-${hash.toString(16).padStart(8, '0')}`;
}
