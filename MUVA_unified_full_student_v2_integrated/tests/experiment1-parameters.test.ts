import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateIrisBasicFlightConfig } from '../src/domain/experimentValidation';
import { createDefaultConfiguration } from '../src/mocks/configuration';

test('experiment one requires the previously learned Iris and its fixed Quad X GUIDED configuration', () => {
  const configuration = createDefaultConfiguration();
  assert.match(validateIrisBasicFlightConfig(configuration) ?? '', /Iris/);
  configuration.selectedDroneId = 'iris-quadrotor-01';
  assert.equal(validateIrisBasicFlightConfig(configuration), null);
  configuration.flightController = { ...configuration.flightController, frameClass: 'Hexa' };
  assert.match(validateIrisBasicFlightConfig(configuration) ?? '', /教学构型/);
  configuration.flightController = { ...configuration.flightController, frameClass: 'Quad', flightMode: 'LOITER' };
  assert.match(validateIrisBasicFlightConfig(configuration) ?? '', /教学构型/);
});

test('experiment one enforces the existing altitude, speed, and hover safety limits', () => {
  const configuration = { ...createDefaultConfiguration(), selectedDroneId: 'iris-quadrotor-01' };
  assert.equal(validateIrisBasicFlightConfig(configuration), null);
  configuration.flightParameters = { ...configuration.flightParameters, rtlAltitude: 5 };
  assert.match(validateIrisBasicFlightConfig(configuration) ?? '', /RTL/);
  configuration.flightParameters = { ...configuration.flightParameters, rtlAltitude: 30, maxSpeed: 0 };
  assert.match(validateIrisBasicFlightConfig(configuration) ?? '', /速度/);
  configuration.flightParameters = { ...configuration.flightParameters, maxSpeed: 5, hoverDuration: 0 };
  assert.match(validateIrisBasicFlightConfig(configuration) ?? '', /悬停/);
});
