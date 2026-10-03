import type { FlightCommandResult, MoveCommand } from '../types/flight';

export interface FlightApi {
  arm(): Promise<FlightCommandResult>;
  disarm(): Promise<FlightCommandResult>;
  takeoff(altitudeMeters: number): Promise<FlightCommandResult>;
  land(): Promise<FlightCommandResult>;
  rtl(): Promise<FlightCommandResult>;
  hold(): Promise<FlightCommandResult>;
  move(command: MoveCommand): Promise<FlightCommandResult>;
}

const acceptMockCommand = (message: string): Promise<FlightCommandResult> =>
  Promise.resolve({
    accepted: true,
    message,
    requestedAt: new Date().toISOString(),
  });

export const flightApi: FlightApi = {
  arm: () => acceptMockCommand('Mock ARM command accepted.'),
  disarm: () => acceptMockCommand('Mock DISARM command accepted.'),
  takeoff: (altitudeMeters) => acceptMockCommand(`Mock takeoff to ${altitudeMeters}m accepted.`),
  land: () => acceptMockCommand('Mock LAND command accepted.'),
  rtl: () => acceptMockCommand('Mock RTL command accepted.'),
  hold: () => acceptMockCommand('Mock HOLD command accepted.'),
  move: ({ direction, magnitude }) =>
    acceptMockCommand(`Mock move ${direction} by ${magnitude} accepted.`),
};
