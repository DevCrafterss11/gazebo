import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';

import { mockScenes } from '../src/mocks/configuration';
import { mockExperiment } from '../src/mocks/experiment';
import { createDefaultConfiguration } from '../src/mocks/configuration';
import { useExperimentStore } from '../src/stores/experimentStore';

test('experiment one has four selectable teaching scenes and keeps legacy scenes for saved records', () => {
  for (const id of ['campus', 'city', 'mountain', 'airport']) {
    const scene = mockScenes.find((item) => item.id === id);
    assert.ok(scene);
    assert.ok(Number.isFinite(scene.latitude) && Number.isFinite(scene.longitude));
    assert.ok(existsSync(`public/experiment3/scenes/${id}-satellite.jpg`));
  }
  assert.ok(mockScenes.some((scene) => scene.id === 'training-field'));
  assert.ok(mockScenes.some((scene) => scene.id === 'open-area'));
});

test('step three begins without an automatic choice and clearing selection blocks advancing', async () => {
  useExperimentStore.setState({
    scenes: mockScenes,
    experiment: { ...mockExperiment, currentStep: 3 },
    configuration: createDefaultConfiguration(),
    selectedScene: null,
    selectedSceneId: '',
    simulationStarted: false,
  });
  assert.equal(useExperimentStore.getState().configuration.selectedSceneId, null);
  await useExperimentStore.getState().goToNextStep();
  assert.equal(useExperimentStore.getState().experiment.currentStep, 3);
  useExperimentStore.getState().selectScene('campus');
  useExperimentStore.getState().selectScene('');
  assert.equal(useExperimentStore.getState().selectedScene, null);
  assert.equal(useExperimentStore.getState().configuration.homePosition, null);
  await useExperimentStore.getState().goToNextStep();
  assert.equal(useExperimentStore.getState().experiment.currentStep, 3);
});

test('switching scenes updates the same experiment one Home configuration used by later steps', () => {
  useExperimentStore.setState({ scenes: mockScenes, simulationStarted: false });
  const store = useExperimentStore.getState();
  store.selectScene('campus');
  assert.equal(useExperimentStore.getState().configuration.selectedSceneId, 'campus');
  assert.equal(useExperimentStore.getState().configuration.homePosition?.latitude, mockScenes.find((scene) => scene.id === 'campus')?.latitude);

  store.selectScene('city');
  assert.equal(useExperimentStore.getState().selectedScene?.id, 'city');
  assert.equal(useExperimentStore.getState().configuration.homePosition?.longitude, mockScenes.find((scene) => scene.id === 'city')?.longitude);
  store.updateHomePosition('latitude', 37.7705);
  assert.equal(useExperimentStore.getState().configuration.homePosition?.latitude, 37.7705);

  store.selectScene('mountain');
  assert.equal(useExperimentStore.getState().configuration.selectedSceneId, 'mountain');
  assert.equal(useExperimentStore.getState().configuration.homePosition?.latitude, mockScenes.find((scene) => scene.id === 'mountain')?.latitude);
  assert.equal(useExperimentStore.getState().configuration.homePosition?.altitude, mockScenes.find((scene) => scene.id === 'mountain')?.altitude);
});

test('experiment one scene selection persists across step navigation and invalid Home blocks advance', async () => {
  const previousStorage = globalThis.localStorage;
  const saved = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
  } as Storage;
  try {
    useExperimentStore.setState({ scenes: mockScenes, experiment: { ...mockExperiment, currentStep: 3 }, completedSteps: [1, 2], simulationStarted: false });
    const store = useExperimentStore.getState();
    store.selectScene('city');
    await store.goToNextStep();
    assert.equal(useExperimentStore.getState().experiment.currentStep, 4);
    assert.equal(useExperimentStore.getState().configuration.selectedSceneId, 'city');
    store.goToPreviousStep();
    assert.equal(useExperimentStore.getState().experiment.currentStep, 3);
    store.selectScene('mountain');
    assert.equal(useExperimentStore.getState().configuration.homePosition?.latitude, mockScenes.find((scene) => scene.id === 'mountain')?.latitude);
    store.updateHomePosition('latitude', Number.NaN);
    await store.goToNextStep();
    assert.equal(useExperimentStore.getState().experiment.currentStep, 3);
    store.selectScene('airport');
    await store.goToNextStep();
    assert.equal(useExperimentStore.getState().experiment.currentStep, 4);
    const persisted = JSON.parse(saved.get('muva-experiment-1') ?? '{}') as { configuration?: { selectedSceneId?: string; homePosition?: { latitude: number } } };
    assert.equal(persisted.configuration?.selectedSceneId, 'airport');
    assert.equal(persisted.configuration?.homePosition?.latitude, mockScenes.find((scene) => scene.id === 'airport')?.latitude);
  } finally {
    globalThis.localStorage = previousStorage;
  }
});
