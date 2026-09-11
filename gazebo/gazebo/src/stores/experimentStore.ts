import { create } from 'zustand';

import { validateFlightParameters } from '../domain/experimentValidation';
import { createDefaultConfiguration, createPreflightChecklist, createUncheckedSensors } from '../mocks/configuration';
import { mockExperiment, mockTrainingScore } from '../mocks/experiment';
import { services } from '../services/serviceRegistry';
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

interface ExperimentState {
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
  activeTaskId: number;
  initialize: () => Promise<void>;
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
  switch (state.experiment.currentStep) {
    case 1: return state.configuration.selectedDroneId ? null : '请先选择无人机型号';
    case 2: return validateFlightParameters(state.configuration.flightParameters);
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
  currentStep,
  completedSteps,
  configuration: state.configuration,
});

let initialized = false;

export const useExperimentStore = create<ExperimentState>((set, get) => {
  const invalidateRuntime = (fromStep: number): void => {
    const state = get();
    const environment = useEnvironmentStore.getState();
    if (state.simulationStarted || environment.isStarting) void environment.stop();
    useFlightStore.getState().reset();
    const completedSteps = state.completedSteps.filter((step) => step < fromStep);
    set({
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
      configuration: { ...get().configuration, sensors: createUncheckedSensors() },
    });
  };

  return {
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
    activeTaskId: 1,
    initialize: async () => {
      if (initialized) return;
      initialized = true;
      useEnvironmentStore.getState().initialize();
      useFlightStore.getState().initialize();
      try {
        const [droneModels, scenes, persisted] = await Promise.all([
          services.drones.getDroneModels(), services.scenes.getScenes(), services.experiments.loadConfiguration(),
        ]);
        if (!persisted) {
          set({ droneModels, scenes });
          return;
        }
        const selectedDrone = droneModels.find((drone) => drone.id === persisted.configuration.selectedDroneId) ?? null;
        const selectedScene = scenes.find((scene) => scene.id === persisted.configuration.selectedSceneId) ?? null;
        const configuration: ExperimentConfiguration = {
          ...persisted.configuration,
          sensors: createUncheckedSensors(),
          homePosition: persisted.configuration.homePosition ?? (selectedScene ? {
            latitude: selectedScene.latitude, longitude: selectedScene.longitude, altitude: selectedScene.altitude,
          } : null),
        };
        set((state) => ({
          droneModels, scenes, configuration, selectedDrone, selectedScene,
          selectedDroneId: configuration.selectedDroneId ?? '',
          selectedSceneId: configuration.selectedSceneId ?? '',
          completedSteps: persisted.completedSteps,
          experiment: updateExperimentSteps(state.experiment, persisted.currentStep, persisted.completedSteps),
        }));
      } catch (error: unknown) {
        set({ initializationError: error instanceof Error ? error.message : 'Backend unavailable' });
        initialized = false;
      }
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
      const parameterError = validateFlightParameters(state.configuration.flightParameters);
      if (!selectedDrone || !selectedScene || !isHomePositionValid(home) || !home || parameterError) {
        set({ validationMessage: parameterError ?? '无人机、场景或 Home Position 配置不完整' });
        return;
      }
      const session = await services.experiments.createExperiment({
        name: '实验一：无人机配置与基础飞行操作', drone: selectedDrone, scene: selectedScene, configuration: state.configuration,
      });
      set({ sessionId: session.id, session, validationMessage: null });
      useNotificationStore.getState().addNotification({ title: '基础飞行实验已创建', detail: `实验 Session ${session.id} 已创建，正在启动仿真环境。`, kind: 'training' });
      try {
        await services.experiments.startExperiment(session.id);
        set((current) => ({ session: current.session ? { ...current.session, status: 'STARTING', startedAt: new Date().toISOString() } : null }));
        await useEnvironmentStore.getState().start({
          experimentId: session.id,
          droneModel: selectedDrone.name,
          vehicleType: state.configuration.flightController.vehicleType,
          frame: `${state.configuration.flightController.frameClass} ${state.configuration.flightController.frameType}`,
          firmware: state.configuration.flightController.firmware,
          scene: selectedScene.name,
          home,
          flightParameters: state.configuration.flightParameters,
        });
        await services.flight.initialize(home, state.configuration.flightParameters.maxAltitude);
        set((current) => ({ simulationStarted: true, session: current.session ? { ...current.session, status: 'RUNNING' } : null, validationMessage: null }));
        await services.experiments.saveConfiguration(persistedState(get(), 4, get().completedSteps));
      } catch (error: unknown) {
        set((current) => ({ simulationStarted: false, validationMessage: error instanceof Error ? error.message : '仿真环境启动失败', session: current.session ? { ...current.session, status: 'FAILED' } : null }));
      }
    },
    runSensorCheck: async () => {
      if (useEnvironmentStore.getState().startup.phase !== 'READY') {
        set({ validationMessage: '仿真环境未 READY，不能执行飞控与传感器检查' });
        return;
      }
      set({ isCheckingSensors: true, systemCheckStatus: 'CHECKING', validationMessage: null });
      try {
        const sensors = await services.experiments.runSensorCheck((items) => set((state) => ({ configuration: { ...state.configuration, sensors: items } })));
        const passed = sensors.every((sensor) => sensor.status === 'PASS');
        set((state) => ({ isCheckingSensors: false, systemCheckStatus: passed ? 'PASSED' : 'FAILED', configuration: { ...state.configuration, sensors } }));
      } catch (error: unknown) {
        set({ isCheckingSensors: false, systemCheckStatus: 'FAILED', validationMessage: error instanceof Error ? error.message : '系统检查失败' });
      }
    },
    runPreflightCheck: async () => {
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
      set({ isCheckingPreflight: true, preflightPassed: false, validationMessage: null });
      try {
        const preflightChecklist = await services.experiments.runPreflightCheck(context, (items) => set({ preflightChecklist: items }));
        const preflightPassed = preflightChecklist.every((item) => item.status === 'PASS');
        set({ preflightChecklist, preflightPassed, isCheckingPreflight: false });
      } catch (error: unknown) {
        set({ isCheckingPreflight: false, preflightPassed: false, validationMessage: error instanceof Error ? error.message : '起飞前检查失败' });
      }
    },
    goToStep: (stepId) => {
      const state = get();
      if (stepId !== state.experiment.currentStep && !state.completedSteps.includes(stepId)) return;
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
      await services.experiments.saveConfiguration(persistedState(state, nextStep, completedSteps));
      set({ completedSteps, experiment: updateExperimentSteps(state.experiment, nextStep, completedSteps), validationMessage: null });
    },
    goToPreviousStep: () => {
      const state = get();
      const previousStep = Math.max(1, state.experiment.currentStep - 1);
      set({ experiment: updateExperimentSteps(state.experiment, previousStep, state.completedSteps), validationMessage: null });
    },
    markSimulationStopped: () => set((state) => ({
      simulationStarted: false,
      systemCheckStatus: 'WAITING',
      preflightPassed: false,
      session: state.session && state.session.status !== 'FINISHED' ? { ...state.session, status: 'FAILED' } : state.session,
    })),
    completeExperiment: async (result) => {
      const state = get();
      const completedSteps = [...new Set([...state.completedSteps, 7, 8])];
      const finalResult = state.sessionId ? await services.experiments.finishExperiment(state.sessionId, result) : result;
      if (state.session) {
        const finishedSession: ExperimentSession = { ...state.session, status: 'FINISHED' };
        const record: ExperimentRecord = {
          id: finishedSession.id, session: finishedSession, result: finalResult,
          telemetryHistory: useTelemetryStore.getState().samples.map((sample) => ({ ...sample, position: { ...sample.position }, attitude: { ...sample.attitude } })),
          tasks: useTrainingStore.getState().tasks.map((task) => ({ ...task })),
          events: [...useTrainingStore.getState().safetyEvents],
          eventTimeline: useTrainingStore.getState().eventTimeline.map((event) => ({ ...event })),
          completedAt: finalResult.completedAt,
        };
        await services.experiments.saveRecord(record);
        void useRecordsStore.getState().refresh();
      }
      set({ result: finalResult, completedSteps, session: state.session ? { ...state.session, status: 'FINISHED' } : null, experiment: updateExperimentSteps(state.experiment, 8, completedSteps) });
      useNotificationStore.getState().addNotification({ title: '基础飞行训练已完成', detail: `训练成绩 ${finalResult.score} 分，实验记录与遥测数据已保存。`, kind: 'training' });
    },
    restartExperiment: async () => {
      await useEnvironmentStore.getState().stop();
      await services.experiments.clearConfiguration();
      useTelemetryStore.getState().clear();
      useTrainingStore.getState().reset();
      useFlightStore.getState().reset();
      const configuration = createDefaultConfiguration();
      set({
        configuration, completedSteps: [], selectedDrone: null, selectedScene: null, selectedDroneId: '', selectedSceneId: '',
        systemCheckStatus: 'WAITING', preflightChecklist: createPreflightChecklist(), preflightPassed: false,
        simulationStarted: false, sessionId: null, session: null, validationMessage: null, result: null,
        initializationError: null, activeTaskId: 1, experiment: updateExperimentSteps(mockExperiment, 1, []),
      });
    },
    clearValidation: () => set({ validationMessage: null }),
  };
});
