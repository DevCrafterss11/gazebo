import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import { resumableExperimentProgress } from '../src/domain/experimentProgress';
import { experiment1LearningError } from '../src/domain/experiment1Workflow';
import { parts, questions } from '../src/domain/assessment/model';
import { showCheckSequence } from '../src/services/checkSequence';
import { geographicBasemapSourceId, geographicMapStyle } from '../src/domain/geographicMap';
import { createInitialExperiment1Assessment } from '../src/domain/experiment1Assessment';
import { createDefaultConfiguration, mockScenes } from '../src/mocks/configuration';
import { mockDroneModels } from '../src/mocks/flight';
import { mockExperiment } from '../src/mocks/experiment';
import { ApiExperimentService } from '../src/services/api/ApiServices';
import { httpClient } from '../src/services/http/client';
import { MockExperimentService } from '../src/services/mock/MockExperimentService';
import type { PersistedExperimentState } from '../src/services/contracts';
import type { SensorCheckItem } from '../src/types/configuration';

const memoryStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
    clear: () => values.clear(),
    key: (index) => [...values.keys()][index] ?? null,
  };
};

const draft = (step = 3): PersistedExperimentState => ({
  version: 2, progressId: 'progress-current-student', currentStep: step, completedSteps: [1, 2],
  configuration: { ...createDefaultConfiguration(), selectedDroneId: 'iris-quadrotor-01', selectedSceneId: 'campus', homePosition: { latitude: 34, longitude: 108, altitude: 412 } },
  learningProgress: { learnedPartIds: ['frame', 'motor'], quizAnswers: { 'system-cognition': { q1: 'answer-in-progress' } } },
});

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage() });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: memoryStorage() });
});

test('first entry ignores empty, legacy unbound and completed progress but resumes a valid unfinished run', () => {
  assert.equal(resumableExperimentProgress(null), null);
  assert.equal(resumableExperimentProgress({ ...draft(7), progressId: undefined }), null);
  assert.equal(resumableExperimentProgress({ ...draft(), currentStep: 9 }), null);
  assert.equal(resumableExperimentProgress({ ...draft(), sessionId: 'missing-session' }), null);
  assert.equal(resumableExperimentProgress({ ...draft(8), assessment: { ...createInitialExperiment1Assessment('session'), finalizedAt: '2026-10-10T00:00:00Z' } }), null);
  assert.equal(resumableExperimentProgress(draft())?.currentStep, 3);
});

test('API stores full progress on backend without inheriting another student’s run', async () => {
  const service = new ApiExperimentService();
  const adapter = httpClient.defaults.adapter;
  const requests: string[] = [];
  const backendProgress = new Map<string, PersistedExperimentState>();
  httpClient.defaults.adapter = async (config) => {
    requests.push(`${config.method} ${config.url}`);
    const progressId = config.url?.split('/progress/')[1];
    if (config.method === 'post' && config.url === '/v1/experiments/configuration') {
      const state = JSON.parse(config.data as string) as PersistedExperimentState;
      backendProgress.set(state.progressId!, state);
    }
    if (config.method === 'delete' && progressId) backendProgress.delete(progressId);
    const data = config.method === 'get' && progressId ? backendProgress.get(progressId) ?? null : { ok: true };
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  try {
    sessionStorage.setItem('muva-username', 'student-one');
    assert.equal(await service.loadConfiguration(), null);
    assert.equal(requests.length, 0);
    await service.saveConfiguration(draft());
    assert.deepEqual(await new ApiExperimentService().loadConfiguration(), draft());
    assert.equal(backendProgress.get(draft().progressId!)?.learningProgress?.learnedPartIds[0], 'frame');
    sessionStorage.setItem('muva-username', 'student-two');
    assert.equal(await service.loadConfiguration(), null);
    sessionStorage.setItem('muva-username', 'student-one');
    assert.equal((await service.loadConfiguration())?.currentStep, 3);
    await service.clearConfiguration();
    assert.equal(await service.loadConfiguration(), null);
    assert.ok(!requests.some((request) => request === 'get /v1/experiments/current'));
  } finally {
    httpClient.defaults.adapter = adapter;
  }
});

test('API assessment uses the Session endpoint, never browser storage', async () => {
  const service = new ApiExperimentService();
  const adapter = httpClient.defaults.adapter;
  const requests: string[] = [];
  const assessment = createInitialExperiment1Assessment('session-1');
  httpClient.defaults.adapter = async (config) => {
    requests.push(`${config.method} ${config.url}`);
    return { data: config.method === 'get' ? assessment : { ok: true }, status: 200, statusText: 'OK', headers: {}, config };
  };
  try {
    await service.saveAssessment(assessment);
    assert.deepEqual(await service.loadAssessment('session-1'), assessment);
    assert.deepEqual(requests, ['put /v1/experiments/session-1/assessment', 'get /v1/experiments/session-1/assessment']);
    assert.equal(localStorage.length, 0);
  } finally {
    httpClient.defaults.adapter = adapter;
  }
});

test('Mock refresh retains the last viewed step, earlier completed steps and learning answers without restoring sensors', async () => {
  const saved = { ...draft(2), completedSteps: [1, 2, 3, 4], configuration: { ...draft().configuration, sensors: [{ id: 'heartbeat' as const, name: 'Heartbeat', status: 'PASS' as const, details: ['old heartbeat'] }] } };
  await new MockExperimentService().saveConfiguration(saved);
  const restored = await new MockExperimentService().loadConfiguration();
  assert.equal(restored?.currentStep, 2);
  assert.deepEqual(restored?.completedSteps, [1, 2, 3, 4]);
  assert.deepEqual(restored?.learningProgress, saved.learningProgress);
  assert.equal(restored?.progressId, saved.progressId);
  assert.ok(restored?.configuration.sensors.every((sensor) => sensor.status === 'WAITING'));
  assert.equal(restored?.sessionId, null);
});

test('restored Mock Session can be started again without creating a different experiment', async () => {
  const source = new MockExperimentService();
  const session = await source.createExperiment({ name: '实验一', drone: mockDroneModels[0]!, scene: mockScenes[0]!, configuration: draft().configuration });
  await source.saveConfiguration({ ...draft(4), sessionId: session.id, session });
  const restored = new MockExperimentService();
  assert.equal((await restored.loadConfiguration())?.sessionId, session.id);
  await restored.startExperiment(session.id);
});

test('store waits for an explicit choice without overwriting saved progress or reconnecting flight', async () => {
  const source = new MockExperimentService();
  const saved = draft(7);
  saved.learningProgress = { learnedPartIds: parts.map((part) => part.id), quizAnswers: { 'system-cognition': { q1: 'saved-answer' } } };
  saved.assessment = createInitialExperiment1Assessment('draft');
  saved.assessment.sectionQuizzes = [{ quizId: 'system-cognition', title: '自测', step: 1, status: 'SUBMITTED',
    answers: Object.fromEntries(questions.map((question) => [question.id, question.answer])),
    questionResults: [], correctCount: questions.length, questionCount: questions.length, rawScore: 100,
    maxScore: 100, normalizedScore: 100, submittedAt: new Date().toISOString(),
  }];
  saved.completedSteps = [1, 2, 3, 4, 5, 6];
  const session = await source.createExperiment({ name: '实验一', drone: mockDroneModels[0]!, scene: mockScenes[0]!, configuration: saved.configuration });
  saved.sessionId = session.id;
  saved.session = session;
  saved.assessment.sessionId = session.id;
  await source.saveConfiguration(saved);
  const serialized = localStorage.getItem('muva-experiment-1');
  const { useExperimentStore } = await import('../src/stores/experimentStore');
  const { useTelemetryStore } = await import('../src/stores/telemetryStore');
  const previousConnect = useTelemetryStore.getState().connect;
  let connections = 0;
  useTelemetryStore.setState({ connect: () => { connections += 1; } });
  try {
    const store = useExperimentStore.getState();
    await store.initialize();
    assert.equal(useExperimentStore.getState().isInitializing, false);
    assert.equal(useExperimentStore.getState().isExperimentActive, false);
    assert.equal(useExperimentStore.getState().savedProgress?.currentStep, 7);
    assert.equal(useExperimentStore.getState().experiment.currentStep, 1);
    assert.deepEqual(useExperimentStore.getState().learningProgress.learnedPartIds, []);
    await store.saveProgress();
    await store.initialize();
    assert.equal(localStorage.getItem('muva-experiment-1'), serialized);
    assert.equal(connections, 0);

    await store.resumeExperiment();
    const restored = useExperimentStore.getState();
    assert.equal(restored.isExperimentActive, true);
    assert.equal(restored.experiment.currentStep, 4);
    assert.deepEqual(restored.completedSteps, [1, 2, 3]);
    assert.equal(restored.progressId, saved.progressId);
    assert.equal(restored.sessionId, session.id);
    assert.deepEqual(restored.learningProgress, saved.learningProgress);
    assert.equal(restored.preflightPassed, false);
    assert.equal(restored.simulationStarted, false);
    assert.equal(connections, 0);
    await store.restartExperiment();
  } finally {
    useTelemetryStore.setState({ connect: previousConnect });
  }
});

test('route return waits for a choice, continuing keeps position and answers, restart creates clean progress', async () => {
  const { useExperimentStore } = await import('../src/stores/experimentStore');
  const { useEnvironmentStore } = await import('../src/stores/environmentStore');
  const { useFlightStore } = await import('../src/stores/flightStore');
  const { useTrainingStore } = await import('../src/stores/trainingStore');
  useEnvironmentStore.setState({ initialize: () => undefined });
  useFlightStore.setState({ initialize: () => undefined });
  const store = useExperimentStore.getState();
  store.showEntry();
  await store.initialize();
  assert.equal(useExperimentStore.getState().isExperimentActive, false);
  assert.equal(useExperimentStore.getState().experiment.currentStep, 1);
  await store.restartExperiment();
  assert.equal(useExperimentStore.getState().isExperimentActive, true);
  store.learnPart('frame');
  store.saveQuizDraft('system-cognition', 'q1', 'draft-answer');
  useExperimentStore.setState({ experiment: { ...mockExperiment, currentStep: 3 }, completedSteps: [1, 2, 3, 4] });
  store.goToPreviousStep();
  await store.saveProgress();
  store.showEntry();
  await store.initialize();
  assert.equal(useExperimentStore.getState().isExperimentActive, false);
  assert.equal(useExperimentStore.getState().savedProgress?.currentStep, 2);
  await store.resumeExperiment();
  assert.equal(useExperimentStore.getState().isExperimentActive, true);
  assert.equal(useExperimentStore.getState().experiment.currentStep, 2);
  assert.deepEqual(useExperimentStore.getState().learningProgress.learnedPartIds, ['frame']);
  assert.equal(useExperimentStore.getState().learningProgress.quizAnswers['system-cognition']?.q1, 'draft-answer');
  assert.equal((await new MockExperimentService().loadConfiguration())?.currentStep, 2);

  useExperimentStore.setState({ experiment: { ...mockExperiment, currentStep: 7 } });
  useTrainingStore.setState({ activeTaskIndex: 5, hoverSeconds: 10 });
  store.showEntry();
  await store.initialize();
  await store.resumeExperiment();
  assert.equal(useExperimentStore.getState().experiment.currentStep, 7);
  assert.equal(useTrainingStore.getState().activeTaskIndex, 5);
  assert.equal(useTrainingStore.getState().hoverSeconds, 10);
  const progressId = useExperimentStore.getState().progressId;
  localStorage.setItem('muva-experiment-records', '[{"id":"previous-record"}]');
  await store.restartExperiment();
  assert.equal(useExperimentStore.getState().isExperimentActive, true);
  assert.equal(useExperimentStore.getState().savedProgress, null);
  assert.equal(useExperimentStore.getState().experiment.currentStep, 1);
  assert.notEqual(useExperimentStore.getState().progressId, progressId);
  assert.deepEqual(useExperimentStore.getState().learningProgress, { learnedPartIds: [], quizAnswers: {} });
  assert.equal(await new MockExperimentService().loadConfiguration(), null);
  assert.equal(localStorage.getItem('muva-experiment-records'), '[{"id":"previous-record"}]');
});

test('learning gates require all parts and submitted answers, never just completedSteps or quiz drafts', () => {
  const progress = draft(1);
  assert.match(experiment1LearningError(1, progress) ?? '', /八个/);
  progress.learningProgress = { learnedPartIds: parts.map((part) => part.id), quizAnswers: {} };
  assert.match(experiment1LearningError(1, progress) ?? '', /提交/);
  progress.assessment = createInitialExperiment1Assessment('draft');
  progress.assessment.sectionQuizzes = [{ quizId: 'system-cognition', title: '自测', step: 1, status: 'SUBMITTED',
    answers: Object.fromEntries(questions.map((question) => [question.id, question.answer])),
    questionResults: [], correctCount: questions.length, questionCount: questions.length, rawScore: 100,
    maxScore: 100, normalizedScore: 100, submittedAt: new Date().toISOString(),
  }];
  assert.equal(experiment1LearningError(1, progress), null);
  assert.match(experiment1LearningError(5, progress) ?? '', /飞控诊断/);
  progress.assessment.sectionQuizzes.push({ ...progress.assessment.sectionQuizzes[0]!, quizId: 'flight-diagnostics',
    answers: { gps: 'wait', ekf: 'calibrate', heartbeat: 'restore' }, step: 5,
  });
  assert.equal(experiment1LearningError(5, progress), null);
  delete progress.assessment.sectionQuizzes[1]!.answers.ekf;
  assert.match(experiment1LearningError(5, progress) ?? '', /提交/);
});

test('API check presentation is progressive and preserves real failures', async () => {
  const updates: string[][] = [];
  const results: SensorCheckItem[] = [
    { id: 'heartbeat', name: 'Heartbeat', status: 'PASS', details: ['online'] },
    { id: 'gps', name: 'GPS', status: 'FAIL', details: ['no fix'] },
  ];
  const checked = await showCheckSequence(results, (items) => updates.push(items.map((item) => item.status)), 'sensor_check', 5);
  assert.deepEqual(updates, [['WAITING', 'WAITING'], ['CHECKING', 'WAITING'], ['PASS', 'WAITING'], ['PASS', 'CHECKING'], ['PASS', 'FAIL']]);
  assert.deepEqual(checked, results);
});

test('cancelled checks cannot publish a late passing result', async () => {
  const controller = new AbortController();
  const updates: string[] = [];
  await assert.rejects(showCheckSequence([{ id: 'gps', name: 'GPS', status: 'PASS', details: ['3D fix'] }], (items) => {
    updates.push(items[0]!.status);
    if (items[0]!.status === 'CHECKING') controller.abort();
  }, 'sensor_check', 5, undefined, controller.signal));
  assert.deepEqual(updates, ['WAITING', 'CHECKING']);
});

test('flight basemap uses geographic XYZ tiles, never a positioned scene photograph', () => {
  const style = geographicMapStyle();
  const source = style.sources[geographicBasemapSourceId];
  assert.ok(source?.type === 'raster');
  assert.deepEqual(source.tiles, ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}']);
  assert.equal(source.maxzoom, 19);
  assert.match(source.attribution ?? '', /Esri/);
  assert.ok(style.layers.some(layer => layer.type === 'raster'));
  assert.ok(Object.values(style.sources).every((entry) => entry.type !== 'image'));
});

test('store blocks skipping learning and saves a pre-session quiz as progress instead of PUT draft', async () => {
  const { useExperimentStore } = await import('../src/stores/experimentStore');
  const { services } = await import('../src/services/serviceRegistry');
  const original = services.experiments;
  let assessmentRequests = 0;
  const service = new MockExperimentService();
  service.saveAssessment = async () => { assessmentRequests += 1; throw new Error('draft session must not be used'); };
  services.experiments = service;
  try {
    const store = useExperimentStore.getState();
    useExperimentStore.setState({ experiment: { ...mockExperiment, currentStep: 1 }, completedSteps: [1, 2],
      selectedDrone: mockDroneModels.find((drone) => drone.id === 'iris-quadrotor-01')!, sessionId: null, assessment: null,
      learningProgress: { learnedPartIds: [], quizAnswers: {} },
    });
    await store.goToNextStep();
    assert.equal(useExperimentStore.getState().experiment.currentStep, 1);
    store.goToStep(2);
    assert.equal(useExperimentStore.getState().experiment.currentStep, 1);
    parts.forEach((part) => store.learnPart(part.id));
    await store.saveSectionQuiz({ quizId: 'system-cognition', title: '认知自测', step: 1,
      questions: questions.map((question) => ({ id: question.id, correctAnswer: question.answer, explanation: question.explanation })),
      answers: Object.fromEntries(questions.map((question) => [question.id, question.answer])),
    });
    assert.equal(assessmentRequests, 0);
    assert.equal(useExperimentStore.getState().assessmentError, null);
    assert.equal((await service.loadConfiguration())?.assessment?.sectionQuizzes.length, 1);
    store.selectScene('city');
    assert.equal(useExperimentStore.getState().assessment?.sectionQuizzes.length, 1);
    await store.goToNextStep();
    assert.equal(useExperimentStore.getState().experiment.currentStep, 2);
  } finally {
    services.experiments = original;
  }
});
