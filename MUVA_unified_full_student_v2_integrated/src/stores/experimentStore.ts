import { create } from 'zustand';

import { validateFlightParameters, validateIrisBasicFlightConfig } from '../domain/experimentValidation';
import { resumableExperimentProgress } from '../domain/experimentProgress';
import { experiment1LearningError } from '../domain/experiment1Workflow';
import { flightMapContextId, validFlightMapView, validMapCoordinates } from '../domain/flightMap';
import type { FlightMapView } from '../types/flightMap';
import { createDefaultConfiguration, createPreflightChecklist, createUncheckedSensors, mockScenes } from '../mocks/configuration';
import { mockExperiment, mockTrainingScore } from '../mocks/experiment';
import { services } from '../services/serviceRegistry';
import { buildPracticalAssessment, calculateExperiment1Score, createFinalExamSnapshot, createInitialExperiment1Assessment, EXPERIMENT1_EXAM_DURATION_MS, gradeFinalExam, gradeSectionQuiz, validateFinalExamSnapshot } from '../domain/experiment1Assessment';
import type { ExperimentOneAssessment, SectionQuizQuestionDefinition } from '../types/experiment1Assessment';
import type { PersistedExperimentState, PreflightCheckContext } from '../services/contracts';
import type { CheckOutcome, ExperimentConfiguration, FlightControllerConfig, FlightParameters, HomePosition, PreflightChecklistItem, TrainingScene } from '../types/configuration';
import type { DroneModel } from '../types/drone';
import type { ExperimentDefinition, ExperimentStep, TrainingScore } from '../types/experiment';
import type { ExperimentRecord } from '../types/record';
import type { ExperimentResult } from '../types/result';
import type { ExperimentSession } from '../types/session';
import { useEnvironmentStore } from './environmentStore';
import { useFlightStore } from './flightStore';
import { useNotificationStore } from './notificationStore';
import { useRecordsStore } from './recordsStore';
import { useTelemetryStore } from './telemetryStore';
import { useTrainingStore } from './trainingStore';
import { useRoutePlannerStore } from './routePlannerStore';

interface ExperimentState {
  isInitializing: boolean;
  isExperimentActive: boolean;
  savedProgress: PersistedExperimentState | null;
  flightMapView: FlightMapView | null;
  setFlightMapView: (view: FlightMapView) => void;
  progressId: string;
  learningProgress: NonNullable<PersistedExperimentState['learningProgress']>;
  experiment: ExperimentDefinition;
  score: TrainingScore;
  droneModels: DroneModel[];
  scenes: TrainingScene[];
  configuration: ExperimentConfiguration;
  completedSteps: number[];
  selectedDrone: DroneModel | null;
  selectedScene: TrainingScene | null;
  selectedDroneId: string;
  selectedSceneId: string;
  systemCheckStatus: CheckOutcome;
  preflightChecklist: PreflightChecklistItem[];
  preflightPassed: boolean;
  isCheckingSensors: boolean;
  isCheckingPreflight: boolean;
  simulationStarted: boolean;
  sessionId: string | null;
  session: ExperimentSession | null;
  validationMessage: string | null;
  initializationError: string | null;
  result: ExperimentResult | null;
  assessment: ExperimentOneAssessment | null;
  assessmentError: string | null;
  isSavingSectionQuiz: boolean;
  activeTaskId: number;
  initialize: () => Promise<void>;
  showEntry: () => void;
  resumeExperiment: () => Promise<void>;
  saveProgress: () => Promise<void>;
  learnPart: (partId: string) => void;
  saveQuizDraft: (quizId: string, questionId: string, answer: string) => void;
  setActiveTask: (taskId: number) => void;
  selectDrone: (droneId: string) => void;
  updateFlightController: (values: Partial<FlightControllerConfig>) => void;
  updateFlightParameter: (field: keyof FlightParameters, value: number) => void;
  selectScene: (sceneId: string) => void;
  updateHomePosition: (field: keyof HomePosition, value: number) => void;
  startSimulation: () => Promise<void>;
  runSensorCheck: () => Promise<void>;
  runPreflightCheck: () => Promise<void>;
  goToStep: (stepId: number) => void;
  goToNextStep: () => Promise<void>;
  goToPreviousStep: () => void;
  markSimulationStopped: () => void;
  completeExperiment: (result: ExperimentResult) => Promise<void>;
  saveSectionQuiz: (quiz: { quizId: 'system-cognition' | 'flight-diagnostics'; title: string; step: number; questions: SectionQuizQuestionDefinition[]; answers: Record<string, string> }) => Promise<void>;
  startFinalExam: () => Promise<void>;
  saveFinalExamAnswer: (questionId: string, answer: string[]) => Promise<void>;
  submitFinalExam: () => Promise<void>;
  retryAssessmentSave: () => Promise<void>;
  finalizeExperimentAssessment: () => Promise<void>;
  restartExperiment: () => Promise<void>;
  clearValidation: () => void;
}

const updateExperimentSteps = (experiment: ExperimentDefinition, currentStep: number, completedSteps: number[]): ExperimentDefinition => ({
  ...experiment,
  currentStep,
  steps: experiment.steps.map<ExperimentStep>((step) => ({
    ...step,
    status: step.id === currentStep ? 'active' : completedSteps.includes(step.id) ? 'completed' : 'pending',
  })),
});

const isHomePositionValid = (home: HomePosition | null): boolean => Boolean(
  home
  && Number.isFinite(home.latitude) && home.latitude >= -90 && home.latitude <= 90
  && Number.isFinite(home.longitude) && home.longitude >= -180 && home.longitude <= 180
  && Number.isFinite(home.altitude),
);

export { validateFlightParameters } from '../domain/experimentValidation';

const getValidationMessage = (state: ExperimentState): string | null => {
  const environment = useEnvironmentStore.getState();
  const learningError = experiment1LearningError(state.experiment.currentStep, state);
  if (learningError) return learningError;
  switch (state.experiment.currentStep) {
    case 1: return state.selectedDrone?.id === 'iris-quadrotor-01' ? null : '请先完成 Iris 四旋翼系统认知';
    case 2: return validateIrisBasicFlightConfig(state.configuration);
    case 3:
      if (!state.configuration.selectedSceneId) return '请选择训练场景';
      return isHomePositionValid(state.configuration.homePosition) ? null : '请设置有效的 Home latitude、longitude 和 altitude';
    case 4: return state.simulationStarted && environment.startup.phase === 'READY' ? null : '请先创建实验并等待仿真环境 READY';
    case 5:
      if (environment.startup.phase !== 'READY') return '仿真环境未 READY，不能执行系统检查';
      return state.systemCheckStatus === 'PASSED' ? null : '请先完成飞控与传感器检查';
    case 6:
      if (state.systemCheckStatus !== 'PASSED') return '飞控与传感器检查未通过';
      return state.preflightPassed ? null : '请先执行起飞前检查';
    case 7: return state.preflightPassed && environment.startup.phase === 'READY' ? null : '起飞前检查未通过';
    default: return null;
  }
};

const persistedState = (state: ExperimentState, currentStep: number, completedSteps: number[]): PersistedExperimentState => ({
  version: 2,
  flightMapView: state.flightMapView,
  progressId: state.progressId,
  learningProgress: state.learningProgress,
  currentStep,
  completedSteps,
  configuration: state.configuration,
  sessionId: state.sessionId,
  session: state.session,
  result: state.result,
  assessment: state.assessment,
});

let initialized = false;
let progressReady = false;

const experiment1SceneIds = ['campus', 'city', 'mountain', 'airport'];
const withExperiment1Scenes = (scenes: TrainingScene[]): TrainingScene[] => [
  ...scenes,
  ...mockScenes.filter((scene) => experiment1SceneIds.includes(scene.id) && !scenes.some((available) => available.id === scene.id)),
];

export const useExperimentStore = create<ExperimentState>((set, get) => {
  let sensorCheck: AbortController | null = null;
  let preflightCheck: AbortController | null = null;
  const cancelChecks = (): void => {
    sensorCheck?.abort();
    preflightCheck?.abort();
    sensorCheck = null;
    preflightCheck = null;
    set((state) => ({ isCheckingSensors: false, isCheckingPreflight: false,
      systemCheckStatus: state.systemCheckStatus === 'CHECKING' ? 'WAITING' : state.systemCheckStatus,
    }));
  };
  const invalidateRuntime = (fromStep: number): void => {
    cancelChecks();
    const state = get();
    const environment = useEnvironmentStore.getState();
    if (state.simulationStarted || environment.isStarting) void environment.stop();
    useFlightStore.getState().reset();
    useTrainingStore.getState().reset();
    useTelemetryStore.getState().disconnect();
    useTelemetryStore.getState().clear();
    useRoutePlannerStore.getState().cancel();
    const completedSteps = state.completedSteps.filter((step) => step < fromStep);
    set({
      flightMapView: null,
      completedSteps,
      experiment: updateExperimentSteps(state.experiment, state.experiment.currentStep, completedSteps),
      systemCheckStatus: 'WAITING',
      preflightChecklist: createPreflightChecklist(),
      preflightPassed: false,
      isCheckingSensors: false,
      isCheckingPreflight: false,
      simulationStarted: false,
      sessionId: null,
      session: null,
      result: null,
      assessment: state.assessment?.sectionQuizzes.length && fromStep > 1
        ? { ...createInitialExperiment1Assessment('draft'), sectionQuizzes: state.assessment.sectionQuizzes }
        : null,
      assessmentError: null,
      configuration: { ...get().configuration, sensors: createUncheckedSensors() },
    });
  };

  return {
    isInitializing: true,
    isExperimentActive: false,
    savedProgress: null,
    flightMapView: null,
    setFlightMapView: (view) => {
      const state = get();
      const home = state.configuration.homePosition;
      if (validFlightMapView(view) && validMapCoordinates(home) && state.selectedScene
        && view.contextId === flightMapContextId(state.progressId, state.selectedScene.id, home)) {
        set({ flightMapView: view });
        void get().saveProgress();
      }
    },
    progressId: crypto.randomUUID(),
    learningProgress: { learnedPartIds: [], quizAnswers: {} },
    experiment: mockExperiment,
    score: mockTrainingScore,
    droneModels: [],
    scenes: [],
    configuration: createDefaultConfiguration(),
    completedSteps: [],
    selectedDrone: null,
    selectedScene: null,
    selectedDroneId: '',
    selectedSceneId: '',
    systemCheckStatus: 'WAITING',
    preflightChecklist: createPreflightChecklist(),
    preflightPassed: false,
    isCheckingSensors: false,
    isCheckingPreflight: false,
    simulationStarted: false,
    sessionId: null,
    session: null,
    validationMessage: null,
    initializationError: null,
    result: null,
    assessment: null,
    assessmentError: null,
    isSavingSectionQuiz: false,
    activeTaskId: 1,
    showEntry: () => {
      const state = get();
      set({
        isExperimentActive: false,
        savedProgress: progressReady
          ? resumableExperimentProgress(persistedState(state, state.experiment.currentStep, state.completedSteps))
          : state.savedProgress,
      });
    },
    initialize: async () => {
      if (initialized) return;
      initialized = true;
      set({ isInitializing: true, isExperimentActive: false, initializationError: null });
      try {
        const [droneModels, availableScenes, savedProgress] = await Promise.all([
          services.drones.getDroneModels(), services.scenes.getScenes(), services.experiments.loadConfiguration(),
        ]);
        const scenes = withExperiment1Scenes(availableScenes);
        set({ droneModels, scenes, savedProgress: resumableExperimentProgress(savedProgress), isInitializing: false });
      } catch (error: unknown) {
        set({ isInitializing: false, initializationError: error instanceof Error ? error.message : '实验进度读取失败，请重试' });
        initialized = false;
      }
    },
    resumeExperiment: async () => {
      const persisted = get().savedProgress;
      if (!persisted || get().isInitializing) return;
      if (progressReady) {
        set({ isExperimentActive: true });
        return;
      }
      const { droneModels, scenes } = get();
      const assessment = persisted.sessionId
        ? await services.experiments.loadAssessment(persisted.sessionId) ?? persisted.assessment ?? null
        : persisted.assessment ?? null;
      useEnvironmentStore.getState().initialize();
      useFlightStore.getState().initialize();
      const selectedDrone = droneModels.find((drone) => drone.id === persisted.configuration.selectedDroneId) ?? null;
      const selectedScene = scenes.find((scene) => scene.id === persisted.configuration.selectedSceneId) ?? null;
      const configuration: ExperimentConfiguration = {
        ...persisted.configuration,
        sensors: createUncheckedSensors(),
        homePosition: persisted.configuration.homePosition ?? (selectedScene ? {
          latitude: selectedScene.latitude, longitude: selectedScene.longitude, altitude: selectedScene.altitude,
        } : null),
      };
      const currentStep = persisted.currentStep > 1 && experiment1LearningError(1, persisted)
        ? 1 : persisted.currentStep >= 5 && persisted.currentStep <= 7 ? 4 : persisted.currentStep;
      const completedSteps = persisted.completedSteps.filter((step) => step < 4 && (step !== 1 || !experiment1LearningError(1, persisted)));
      set((state) => ({
        flightMapView: validFlightMapView(persisted.flightMapView) ? persisted.flightMapView : null,
        progressId: persisted.progressId ?? state.progressId,
        learningProgress: persisted.learningProgress ?? { learnedPartIds: [], quizAnswers: {} },
        droneModels, scenes, configuration, selectedDrone, selectedScene,
        selectedDroneId: configuration.selectedDroneId ?? '',
        selectedSceneId: configuration.selectedSceneId ?? '',
        completedSteps,
        experiment: updateExperimentSteps(state.experiment, currentStep, completedSteps),
        sessionId: persisted.sessionId ?? null,
        session: persisted.session ?? null,
        result: persisted.result ?? null,
        assessment,
        isExperimentActive: true,
      }));
      if (persisted.sessionId) {
        useTelemetryStore.getState().setMapContext(persisted.sessionId, Date.parse(persisted.session?.startedAt ?? '') || Date.now());
      }
      progressReady = true;
    },
    saveProgress: async () => {
      if (!progressReady) return;
      const state = get();
      try {
        await services.experiments.saveConfiguration(persistedState(state, state.experiment.currentStep, state.completedSteps));
      } catch (error: unknown) {
        set({ validationMessage: error instanceof Error ? `实验进度保存失败：${error.message}` : '实验进度保存失败，请重试' });
      }
    },
    learnPart: (partId) => set((state) => ({ learningProgress: { ...state.learningProgress, learnedPartIds: [...new Set([...state.learningProgress.learnedPartIds, partId])] } })),
    saveQuizDraft: (quizId, questionId, answer) => {
      if (get().assessment?.sectionQuizzes.some((quiz) => quiz.quizId === quizId)) return;
      set((state) => ({ learningProgress: { ...state.learningProgress, quizAnswers: { ...state.learningProgress.quizAnswers, [quizId]: { ...state.learningProgress.quizAnswers[quizId], [questionId]: answer } } } }));
    },
    setActiveTask: (activeTaskId) => set({ activeTaskId }),
    selectDrone: (selectedDroneId) => {
      invalidateRuntime(1);
      set((state) => ({
        selectedDroneId,
        selectedDrone: state.droneModels.find((drone) => drone.id === selectedDroneId) ?? null,
        configuration: { ...state.configuration, selectedDroneId },
        validationMessage: null,
      }));
    },
    updateFlightController: (values) => {
      invalidateRuntime(2);
      set((state) => ({ configuration: { ...state.configuration, flightController: { ...state.configuration.flightController, ...values } }, validationMessage: null }));
    },
    updateFlightParameter: (field, value) => {
      invalidateRuntime(2);
      set((state) => ({ configuration: { ...state.configuration, flightParameters: { ...state.configuration.flightParameters, [field]: value } }, validationMessage: null }));
    },
    selectScene: (selectedSceneId) => {
      invalidateRuntime(3);
      set((state) => {
        const selectedScene = state.scenes.find((scene) => scene.id === selectedSceneId) ?? null;
        return {
          selectedSceneId, selectedScene,
          configuration: {
            ...state.configuration, selectedSceneId,
            homePosition: selectedScene ? { latitude: selectedScene.latitude, longitude: selectedScene.longitude, altitude: selectedScene.altitude } : null,
          },
          validationMessage: null,
        };
      });
    },
    updateHomePosition: (field, value) => {
      invalidateRuntime(3);
      set((state) => ({
        configuration: {
          ...state.configuration,
          homePosition: { ...(state.configuration.homePosition ?? { latitude: 0, longitude: 0, altitude: 0 }), [field]: value },
        },
        validationMessage: null,
      }));
    },
    startSimulation: async () => {
      const state = get();
      const { selectedDrone, selectedScene } = state;
      const home = state.configuration.homePosition;
      const configurationError = validateIrisBasicFlightConfig(state.configuration);
      if (selectedDrone?.id !== 'iris-quadrotor-01' || !selectedScene || !isHomePositionValid(home) || !home || configurationError) {
        set({ validationMessage: configurationError ?? '无人机、场景或 Home Position 配置不完整' });
        return;
      }
      try {
        const current = get();
        const hasCurrentSession = Boolean(current.sessionId && current.session);
        const session = hasCurrentSession
          ? current.session
          : await services.experiments.createExperiment({
              name: '实验一：无人机配置与基础飞行操作', drone: selectedDrone, scene: selectedScene, configuration: state.configuration,
            });
        if (!session) throw new Error('实验 Session 创建失败');
        const assessment = current.sessionId === session.id && current.assessment
          ? current.assessment
          : { ...createInitialExperiment1Assessment(session.id), sectionQuizzes: current.assessment?.sectionQuizzes ?? [] };
        set({ sessionId: session.id, session, assessment, validationMessage: null, assessmentError: null });
        await services.experiments.saveAssessment(assessment);
        useNotificationStore.getState().addNotification({ title: '基础飞行实验已创建', detail: `实验 Session ${session.id} 已创建，正在启动仿真环境。`, kind: 'training' });
        if (session.status !== 'RUNNING' && session.status !== 'FINISHED') {
          await services.experiments.startExperiment(session.id);
        }
        set((currentState) => ({ session: currentState.session ? { ...currentState.session, status: 'STARTING', startedAt: currentState.session.startedAt ?? new Date().toISOString() } : null }));
        const environment = useEnvironmentStore.getState();
        if (environment.startup.phase !== 'READY' || !current.simulationStarted) {
          await environment.start({
            experimentId: session.id,
            droneModel: selectedDrone.name,
            vehicleType: state.configuration.flightController.vehicleType,
            frame: `${state.configuration.flightController.frameClass} ${state.configuration.flightController.frameType}`,
            firmware: state.configuration.flightController.firmware,
            scene: selectedScene.name,
            home,
            flightParameters: state.configuration.flightParameters,
          });
        }
        await services.flight.initialize(home, state.configuration.flightParameters.maxAltitude);
        useTelemetryStore.getState().setMapContext(session.id, Date.parse(get().session?.startedAt ?? '') || Date.now());
        useTelemetryStore.getState().connect();
        set((current) => ({ simulationStarted: true, session: current.session ? { ...current.session, status: 'RUNNING' } : null, validationMessage: null }));
        await services.experiments.saveConfiguration(persistedState(get(), 4, get().completedSteps));
      } catch (error: unknown) {
        set((current) => ({ simulationStarted: false, validationMessage: error instanceof Error ? error.message : '仿真环境启动失败', session: current.session ? { ...current.session, status: 'FAILED' } : null }));
      }
    },
    runSensorCheck: async () => {
      if (get().isCheckingSensors) return;
      if (useEnvironmentStore.getState().startup.phase !== 'READY') {
        set({ validationMessage: '仿真环境未 READY，不能执行飞控与传感器检查' });
        return;
      }
      cancelChecks();
      const controller = new AbortController();
      sensorCheck = controller;
      set((state) => ({ isCheckingSensors: true, systemCheckStatus: 'CHECKING', preflightPassed: false,
        preflightChecklist: createPreflightChecklist(), validationMessage: null,
        configuration: { ...state.configuration, sensors: createUncheckedSensors() },
        completedSteps: state.completedSteps.filter((step) => step < 5),
      }));
      try {
        const sensors = await services.experiments.runSensorCheck((items) => {
          if (!controller.signal.aborted) set((state) => ({ configuration: { ...state.configuration, sensors: items } }));
        }, undefined, controller.signal);
        if (controller.signal.aborted) return;
        const passed = createUncheckedSensors().every((expected) => sensors.some((sensor) => sensor.id === expected.id && sensor.status === 'PASS'));
        set((state) => ({ isCheckingSensors: false, systemCheckStatus: passed ? 'PASSED' : 'FAILED', configuration: { ...state.configuration, sensors } }));
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        set({ isCheckingSensors: false, systemCheckStatus: 'FAILED', validationMessage: error instanceof Error ? error.message : '系统检查失败' });
      }
    },
    runPreflightCheck: async () => {
      if (get().isCheckingPreflight) return;
      const environment = useEnvironmentStore.getState();
      const state = get();
      if (environment.startup.phase !== 'READY') {
        set({ validationMessage: '仿真环境未 READY，不能执行起飞前检查' });
        return;
      }
      if (state.systemCheckStatus !== 'PASSED') {
        set({ validationMessage: '飞控与传感器检查未通过，不能执行起飞前检查' });
        return;
      }
      const context: PreflightCheckContext = {
        configuration: state.configuration,
        runtime: environment.runtime,
        environmentReady: true,
        systemCheckStatus: state.systemCheckStatus,
        vehicleArmed: useFlightStore.getState().status.armed,
      };
      const controller = new AbortController();
      preflightCheck = controller;
      set({ isCheckingPreflight: true, preflightPassed: false, preflightChecklist: createPreflightChecklist(), validationMessage: null });
      try {
        const preflightChecklist = await services.experiments.runPreflightCheck(context, (items) => {
          if (!controller.signal.aborted) set({ preflightChecklist: items });
        }, undefined, controller.signal);
        if (controller.signal.aborted) return;
        const preflightPassed = createPreflightChecklist().every((expected) => preflightChecklist.some((item) => item.id === expected.id && item.status === 'PASS'));
        set({ preflightChecklist, preflightPassed, isCheckingPreflight: false });
      } catch (error: unknown) {
        if (controller.signal.aborted) return;
        set({ isCheckingPreflight: false, preflightPassed: false, validationMessage: error instanceof Error ? error.message : '起飞前检查失败' });
      }
    },
    goToStep: (stepId) => {
      const state = get();
      if (stepId !== state.experiment.currentStep && !state.completedSteps.includes(stepId)) return;
      const learningError = [1, 5].filter((step) => step < stepId).map((step) => experiment1LearningError(step, state)).find(Boolean);
      if (learningError) {
        set({ validationMessage: learningError });
        return;
      }
      if (stepId >= 5 && useEnvironmentStore.getState().startup.phase !== 'READY') {
        set({ validationMessage: '仿真环境未 READY，无法进入该步骤' });
        return;
      }
      if (stepId >= 6 && state.systemCheckStatus !== 'PASSED') {
        set({ validationMessage: '请先通过飞控与传感器检查' });
        return;
      }
      if (stepId >= 7 && !state.preflightPassed) {
        set({ validationMessage: '请先通过起飞前检查' });
        return;
      }
      set({ experiment: updateExperimentSteps(state.experiment, stepId, state.completedSteps), validationMessage: null });
      void get().saveProgress();
    },
    goToNextStep: async () => {
      const state = get();
      const validationMessage = getValidationMessage(state);
      if (validationMessage) {
        set({ validationMessage });
        return;
      }
      const currentStep = state.experiment.currentStep;
      const completedSteps = [...new Set([...state.completedSteps, currentStep])];
      const nextStep = Math.min(8, currentStep + 1);
      try {
        await services.experiments.saveConfiguration(persistedState(state, nextStep, completedSteps));
        set({ completedSteps, experiment: updateExperimentSteps(state.experiment, nextStep, completedSteps), validationMessage: null });
      } catch (error: unknown) {
        set({ validationMessage: error instanceof Error ? `实验进度保存失败：${error.message}` : '实验进度保存失败，请重试' });
      }
    },
    goToPreviousStep: () => {
      cancelChecks();
      const state = get();
      const previousStep = Math.max(1, state.experiment.currentStep - 1);
      set({ experiment: updateExperimentSteps(state.experiment, previousStep, state.completedSteps), validationMessage: null });
      void get().saveProgress();
    },
    markSimulationStopped: () => set((state) => ({
      simulationStarted: false,
      systemCheckStatus: 'WAITING',
      preflightPassed: false,
      session: state.session && state.session.status !== 'FINISHED' ? { ...state.session, status: 'FAILED' } : state.session,
    })),
    completeExperiment: async (result) => {
      const state = get();
      if (!state.sessionId) {
        set({ assessmentError: '实验 Session 缺失，无法保存实操成绩。' });
        return;
      }
      const eventTimeline = useTrainingStore.getState().eventTimeline.map((event, index) => ({ ...event, id: `training-${index + 1}` }));
      const assessment = {
        ...(state.assessment ?? createInitialExperiment1Assessment(state.sessionId)),
        status: 'AWAITING_EXAM' as const,
        practicalResult: result,
        practicalAssessment: buildPracticalAssessment(result, eventTimeline),
      };
      const completedSteps = [...new Set([...state.completedSteps, 7])];
      set({ result, assessment, completedSteps, experiment: updateExperimentSteps(state.experiment, 8, completedSteps), assessmentError: null });
      try {
        await services.experiments.saveAssessment(assessment);
        await services.experiments.saveConfiguration(persistedState(get(), 8, completedSteps));
      } catch (error: unknown) {
        set({ assessmentError: error instanceof Error ? error.message : '实操评分保存失败', assessment: { ...assessment, status: 'ERROR' } });
        return;
      }
      useNotificationStore.getState().addNotification({ title: '基础飞行训练已完成', detail: '实操评分已保存，Gazebo 与飞控保持运行，可前往实时飞控观察仿真；请完成步骤8理论考核后结算实验成绩。', kind: 'training' });
    },
    saveSectionQuiz: async ({ quizId, title, step, questions, answers }) => {
      if (get().isSavingSectionQuiz) return;
      if (!questions.length || questions.some((question) => !answers[question.id])) {
        set({ assessmentError: '请回答全部自测题后再提交' });
        return;
      }
      const { sessionId, assessment } = get();
      const assessmentId = sessionId ?? 'draft';
      const current = assessment ?? createInitialExperiment1Assessment(assessmentId);
      if (current.sectionQuizzes.some((quiz) => quiz.quizId === quizId)) return;
      const graded = gradeSectionQuiz(questions, answers);
      const quiz = { quizId, title, step, status: 'SUBMITTED' as const, answers, questionResults: graded.questionResults, correctCount: graded.correctCount, questionCount: questions.length, rawScore: graded.rawScore, maxScore: graded.maxScore, normalizedScore: graded.normalizedScore, submittedAt: new Date().toISOString() };
      const next = { ...current, sectionQuizzes: [...current.sectionQuizzes, quiz] };
      set({ isSavingSectionQuiz: true, assessmentError: null });
      try {
        if (sessionId) await services.experiments.saveAssessment(next);
        await services.experiments.saveConfiguration({ ...persistedState(get(), get().experiment.currentStep, get().completedSteps), assessment: next });
        set({ assessment: next });
      } catch (error: unknown) {
        set({ assessmentError: error instanceof Error ? error.message : '小节测验保存失败' });
      } finally {
        set({ isSavingSectionQuiz: false });
      }
    },
    startFinalExam: async () => {
      const { sessionId, result } = get();
      if (!sessionId || !result) {
        set({ assessmentError: '请先完成步骤7飞行训练，才能开始最终理论考核。' });
        return;
      }
      const current = get().assessment ?? createInitialExperiment1Assessment(sessionId);
      if (current.exam.status !== 'NOT_STARTED') return;
      const questionSnapshot = createFinalExamSnapshot(current.practicalAssessment?.evidenceEvents ?? []);
      const examError = validateFinalExamSnapshot(questionSnapshot);
      if (examError) {
        set({ assessmentError: examError, assessment: { ...current, status: 'ERROR' } });
        return;
      }
      const startedAt = new Date();
      const exam = { ...current.exam, status: 'IN_PROGRESS' as const, questionSnapshot, startedAt: startedAt.toISOString(), deadline: new Date(startedAt.getTime() + EXPERIMENT1_EXAM_DURATION_MS).toISOString() };
      const next = { ...current, status: 'EXAM_IN_PROGRESS' as const, exam };
      set({ assessment: next, assessmentError: null });
      try {
        await services.experiments.saveAssessment(next);
      } catch (error: unknown) {
        set({ assessmentError: error instanceof Error ? error.message : '理论考试初始化保存失败' });
      }
    },
    saveFinalExamAnswer: async (questionId, answer) => {
      const current = get().assessment;
      if (!current || current.exam.status !== 'IN_PROGRESS') return;
      const question = current.exam.questionSnapshot.find((item) => item.id === questionId);
      if (!question) return;
      const normalized = [...new Set(answer)].filter((id) => question.options.some((option) => option.id === id));
      const next = { ...current, exam: { ...current.exam, answers: { ...current.exam.answers, [questionId]: normalized } } };
      set({ assessment: next });
      try {
        await services.experiments.saveAssessment(next);
      } catch {
        set({ assessmentError: '答案保存失败，请检查存储状态后重试；当前答案暂留在页面中。' });
      }
    },
    submitFinalExam: async () => {
      const { assessment } = get();
      if (!assessment || assessment.exam.status !== 'IN_PROGRESS') return;
      const graded = gradeFinalExam(assessment.exam.questionSnapshot, assessment.exam.answers);
      const next = { ...assessment, status: 'AWAITING_FINALIZATION' as const, exam: { ...assessment.exam, status: 'SUBMITTED' as const, submittedAt: new Date().toISOString(), rawScore: graded.score, questionResults: graded.results } };
      set({ assessment: next, assessmentError: null });
      try {
        await services.experiments.saveAssessment(next);
      } catch (error: unknown) {
        set({ assessmentError: error instanceof Error ? error.message : '理论考试结果保存失败', assessment: { ...next, status: 'ERROR' } });
      }
    },
    retryAssessmentSave: async () => {
      const current = get().assessment;
      if (!current) return;
      try {
        await services.experiments.saveAssessment(current);
        const status = current.finalizedAt ? 'GRADED' as const : current.exam.status === 'SUBMITTED' ? 'AWAITING_FINALIZATION' as const : current.exam.status === 'IN_PROGRESS' ? 'EXAM_IN_PROGRESS' as const : current.status;
        set({ assessment: { ...current, status }, assessmentError: null });
      } catch (error: unknown) {
        set({ assessmentError: error instanceof Error ? error.message : '评分记录保存失败，请稍后重试' });
      }
    },
    finalizeExperimentAssessment: async () => {
      const state = get();
      if (!state.sessionId || !state.session || !state.result || !state.assessment || state.assessment.status === 'ERROR' || state.assessment.exam.status !== 'SUBMITTED' || state.assessment.finalizedAt) return;
      const practicalRaw = state.assessment.practicalAssessment?.rawScore ?? state.assessment.practicalResult?.score;
      if (practicalRaw === undefined) {
        set({ assessmentError: '实操评分证据缺失，无法正式结算。' });
        return;
      }
      const scores = calculateExperiment1Score(practicalRaw, state.assessment.sectionQuizzes, state.assessment.exam.rawScore);
      if (scores.total === null) {
        set({ assessmentError: '评分项配置不完整，无法正式结算。' });
        return;
      }
      const assessment = { ...state.assessment, status: 'GRADED' as const, finalResult: scores, finalizedAt: new Date().toISOString(), totalScore: scores.total };
      try {
        const finalResult = await services.experiments.finishExperiment(state.sessionId, { ...state.result, score: scores.total });
        const finishedSession: ExperimentSession = { ...state.session, status: 'FINISHED' };
        const record: ExperimentRecord = {
          id: finishedSession.id, session: finishedSession, result: finalResult, assessment,
          telemetryHistory: useTelemetryStore.getState().samples.map((sample) => ({ ...sample, position: { ...sample.position }, attitude: { ...sample.attitude } })),
          tasks: useTrainingStore.getState().tasks.map((task) => ({ ...task })),
          events: [...useTrainingStore.getState().safetyEvents],
          eventTimeline: useTrainingStore.getState().eventTimeline.map((event) => ({ ...event })),
          completedAt: assessment.finalizedAt,
        };
        await services.experiments.saveRecord(record);
        await services.experiments.saveAssessment(assessment);
        const completedSteps = [...new Set([...state.completedSteps, 7, 8])];
        set({ result: finalResult, assessment, completedSteps, session: finishedSession, experiment: updateExperimentSteps(state.experiment, 8, completedSteps), assessmentError: null });
        await services.experiments.saveConfiguration(persistedState(get(), 8, completedSteps));
        void useRecordsStore.getState().refresh();
      } catch (error: unknown) {
        set({ assessmentError: error instanceof Error ? error.message : '综合成绩或实验记录保存失败', assessment: { ...assessment, status: 'ERROR' } });
      }
    },
    restartExperiment: async () => {
      cancelChecks();
      useEnvironmentStore.getState().initialize();
      useFlightStore.getState().initialize();
      await useEnvironmentStore.getState().stop();
      await services.experiments.clearConfiguration();
      useTelemetryStore.getState().clear();
      useTrainingStore.getState().reset();
      useFlightStore.getState().reset();
      useRoutePlannerStore.getState().cancel();
      const configuration = createDefaultConfiguration();
      progressReady = true;
      set({
        savedProgress: null, isExperimentActive: true, score: mockTrainingScore,
        flightMapView: null,
        progressId: crypto.randomUUID(), learningProgress: { learnedPartIds: [], quizAnswers: {} },
        configuration, completedSteps: [], selectedDrone: null, selectedScene: null, selectedDroneId: '', selectedSceneId: '',
        systemCheckStatus: 'WAITING', preflightChecklist: createPreflightChecklist(), preflightPassed: false,
        simulationStarted: false, sessionId: null, session: null, validationMessage: null, result: null, assessment: null, assessmentError: null,
        initializationError: null, isSavingSectionQuiz: false, activeTaskId: 1, experiment: updateExperimentSteps(mockExperiment, 1, []),
      });
    },
    clearValidation: () => set({ validationMessage: null }),
  };
});
