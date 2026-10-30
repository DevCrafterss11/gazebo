import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { ApiSwarmService } from '../src/services/api/ApiSwarmService';
import type { SwarmSnapshot } from '../src/types/swarm';

type Reply = { data: unknown; status: number; statusText: string; headers: Record<string, string>; config: InternalAxiosRequestConfig };

const groundedSnapshot = (connected = true, armed = false, altitude = 0.1): SwarmSnapshot => ({
  status: 'COMPLETED', elapsed: 0, events: [], coverage: 100,
  drones: [{ droneId: 'uav-1', connected, armed, altitude } as SwarmSnapshot['drones'][number]],
});

const withAdapter = async (
  respond: (config: InternalAxiosRequestConfig) => unknown,
  run: (service: ApiSwarmService, requests: string[]) => Promise<void>,
) => {
  const service = new ApiSwarmService();
  const client = (service as unknown as { client: AxiosInstance }).client;
  const requests: string[] = [];
  client.defaults.adapter = async config => {
    requests.push(`${config.method?.toUpperCase()} ${config.url}`);
    const data = respond(config);
    const reply: Reply = { data, status: 200, statusText: 'OK', headers: {}, config };
    return reply;
  };
  try { await run(service, requests); }
  finally { service.dispose(); }
};

test('stale local session with no backend session clears locally without shutdown request', async () => {
  await withAdapter(config => config.url === '/health' ? { sessionId: null } : null, async (service, requests) => {
    await service.shutdown('expired-session');
    assert.deepEqual(requests, ['GET /health']);
  });
});

test('session mismatch closes backend session only after confirming whole fleet grounded', async () => {
  await withAdapter(config => {
    if (config.url === '/health') return { sessionId: 'active-session' };
    if (config.url === '/status') return groundedSnapshot();
    return { stopped: true };
  }, async (_service, requests) => {
    await _service.shutdown('expired-session');
    assert.deepEqual(requests, ['GET /health', 'GET /status', 'POST /shutdown']);
  });
});

test('session mismatch never shuts down when telemetry cannot confirm a grounded fleet', async () => {
  await withAdapter(config => {
    if (config.url === '/health') return { sessionId: 'active-session' };
    if (config.url === '/status') return groundedSnapshot(false, false, 0.1);
    return { stopped: true };
  }, async (service, requests) => {
    await assert.rejects(service.shutdown('expired-session'), /无法确认全部飞控在线、上锁并落地/);
    assert.deepEqual(requests, ['GET /health', 'GET /status']);
  });
});

test('explicit simulation abort only calls the SITL abort endpoint for the active backend session', async () => {
  await withAdapter(config => config.url === '/health' ? { sessionId: 'active-session' } : { aborted: true, landed: false }, async (service, requests) => {
    await service.abortSimulation('stale-local-session');
    assert.deepEqual(requests, ['GET /health', 'POST /abort-simulation']);
  });
});
