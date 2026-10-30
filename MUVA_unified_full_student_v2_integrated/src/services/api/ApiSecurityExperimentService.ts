import type { SecurityExperimentService, SecurityRangeSnapshot } from '../contracts';
import type { SecurityConfig, SecurityEvidence, SecurityJudgment, SecurityReport, SecurityRun, SecurityTelemetry } from '../../types/securityExperiment';
import { securityHttpClient } from '../http/client';

function isSecurityTelemetry(value: unknown): value is SecurityTelemetry {
  if (!value || typeof value !== 'object') return false;
  const sample = value as Partial<SecurityTelemetry>;
  return sample.protocolVersion === 'security.telemetry.v1' && typeof sample.runId === 'string'
    && (sample.source === 'mavlink' || sample.source === 'simulation') && Number.isInteger(sample.sequence)
    && typeof sample.capturedAt === 'number' && typeof sample.receivedAt === 'number'
    && typeof sample.elapsedMs === 'number' && (sample.receiveIntervalMs === undefined || sample.receiveIntervalMs === null || typeof sample.receiveIntervalMs === 'number')
    && (sample.missingRatePct === undefined || sample.missingRatePct === null || typeof sample.missingRatePct === 'number') && typeof sample.altitude === 'number'
    && typeof sample.speed === 'number' && typeof sample.battery === 'number'
    && typeof sample.stale === 'boolean'
    && (sample.connection === 'connected' || sample.connection === 'interrupted' || sample.connection === 'unavailable');
}

function isSecurityEvidence(value: unknown): value is SecurityEvidence {
  if (!value || typeof value !== 'object') return false;
  const evidence = value as Partial<SecurityEvidence>;
  const codes: SecurityEvidence['code'][] = ['duplicate_sequence', 'sequence_regression', 'stale_data', 'receive_gap', 'packet_loss', 'connection_interrupted', 'recovered'];
  return typeof evidence.id === 'string' && typeof evidence.detail === 'string'
    && typeof evidence.receivedAt === 'number' && typeof evidence.automatic === 'boolean'
    && evidence.code !== undefined && codes.includes(evidence.code);
}

export class ApiSecurityExperimentService implements SecurityExperimentService {
  async getRangeStatus(): Promise<SecurityRangeSnapshot> { return (await securityHttpClient.get<SecurityRangeSnapshot>('/v1/security/range/status')).data; }
  async startRange(): Promise<SecurityRangeSnapshot> { return (await securityHttpClient.post<SecurityRangeSnapshot>('/v1/security/range/start', undefined, { timeout: 45_000 })).data; }
  async stopRange(): Promise<{ ok: boolean }> { return (await securityHttpClient.post<{ ok: boolean }>('/v1/security/range/stop')).data; }
  async takeoffRange(altitude: number): Promise<unknown> { return (await securityHttpClient.post('/v1/security/range/takeoff', { altitude })).data; }
  async moveRange(direction: 'forward' | 'backward' | 'left' | 'right', meters: number): Promise<unknown> { return (await securityHttpClient.post('/v1/security/range/move', { direction, meters })).data; }
  async landRange(): Promise<unknown> { return (await securityHttpClient.post('/v1/security/range/land')).data; }
  async executeSimulationMotorStop(): Promise<{ accepted: boolean; effect: 'motors_stopped' }> {
    return (await securityHttpClient.post<{ accepted: boolean; effect: 'motors_stopped' }>('/v1/security/simulation/motor-stop')).data;
  }
  async executeWaypointTampering(input: { waypoints: { latitude: number; longitude: number }[]; offsetSide: 'left' | 'right' }): Promise<{ accepted: boolean; effect: 'mission_replaced_and_started'; tamperedIndex: number; offsetMeters: number }> {
    return (await securityHttpClient.post('/v1/security/simulation/waypoint-tampering', input)).data;
  }
  async executeRangeMission(waypoints: { latitude: number; longitude: number }[]): Promise<{ accepted: boolean; effect: 'original_mission_started' }> {
    return (await securityHttpClient.post('/v1/security/range/mission-start', { waypoints })).data;
  }
  async injectRangeWaypoint(input: { latitude: number; longitude: number; altitude: number }): Promise<{ accepted: boolean; effect: 'guided_waypoint_injected' }> {
    return (await securityHttpClient.post('/v1/security/range/inject-waypoint', input)).data;
  }
  async createRun(config: SecurityConfig): Promise<SecurityRun> { return (await securityHttpClient.post<SecurityRun>('/v1/security/runs', config)).data; }
  async getRun(runId: string): Promise<SecurityRun | null> { return (await securityHttpClient.get<SecurityRun | null>(`/v1/security/runs/${encodeURIComponent(runId)}`)).data; }
  async listReports(): Promise<SecurityReport[]> { return (await securityHttpClient.get<SecurityReport[]>('/v1/security/records')).data; }
  async startBaseline(runId: string): Promise<SecurityRun> { return (await securityHttpClient.post<SecurityRun>(`/v1/security/runs/${encodeURIComponent(runId)}/baseline`)).data; }
  async startAnomaly(runId: string): Promise<SecurityRun> { return (await securityHttpClient.post<SecurityRun>(`/v1/security/runs/${encodeURIComponent(runId)}/anomaly`)).data; }
  async submitJudgment(runId: string, judgment: SecurityJudgment, evidenceIds: string[], requestId: string): Promise<SecurityRun> { return (await securityHttpClient.post<SecurityRun>(`/v1/security/runs/${encodeURIComponent(runId)}/judgment`, { judgment, evidenceIds, requestId })).data; }
  async isolate(runId: string): Promise<SecurityRun> { return (await securityHttpClient.post<SecurityRun>(`/v1/security/runs/${encodeURIComponent(runId)}/isolate`)).data; }
  async stopInjection(runId: string): Promise<SecurityRun> { return (await securityHttpClient.post<SecurityRun>(`/v1/security/runs/${encodeURIComponent(runId)}/stop-injection`)).data; }
  async verifyRecovery(runId: string): Promise<SecurityRun> { return (await securityHttpClient.post<SecurityRun>(`/v1/security/runs/${encodeURIComponent(runId)}/verify`)).data; }
  async finish(runId: string, reflection: string): Promise<SecurityReport> { return (await securityHttpClient.post<SecurityReport>(`/v1/security/runs/${encodeURIComponent(runId)}/finish`, { reflection })).data; }
  async abort(runId: string): Promise<SecurityReport> { return (await securityHttpClient.post<SecurityReport>(`/v1/security/runs/${encodeURIComponent(runId)}/abort`)).data; }
  subscribe(runId: string, onSample: (sample: SecurityTelemetry) => void, onEvidence: (items: SecurityEvidence[]) => void): () => void {
    const base = import.meta.env.VITE_SECURITY_API_BASE_URL ?? 'http://127.0.0.1:8004/api';
    const endpoint = `${base.replace(/^http/, 'ws').replace(/\/api\/?$/, '')}/ws/security/${encodeURIComponent(runId)}`;
    let socket: WebSocket | null = null;
    let closed = false;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let lastSample: SecurityTelemetry | null = null;
    const connect = (): void => {
      if (closed) return;
      socket = new WebSocket(endpoint);
      socket.onmessage = (event: MessageEvent<string>) => {
      try {
        const message: unknown = JSON.parse(event.data);
        if (!message || typeof message !== 'object') return;
        const envelope = message as { protocolVersion?: unknown; type?: unknown; sample?: unknown; evidence?: unknown };
        if (envelope.protocolVersion !== 'security.telemetry.v1') return;
        if (envelope.type === 'security.sample' && isSecurityTelemetry(envelope.sample) && envelope.sample.runId === runId) {
          lastSample = envelope.sample;
          onSample(envelope.sample);
        }
        if (envelope.type === 'security.evidence' && Array.isArray(envelope.evidence)) {
          const evidence = envelope.evidence.filter(isSecurityEvidence);
          if (evidence.length) onEvidence(evidence);
        }
      } catch (error: unknown) { console.error('Invalid security experiment event', error); }
      };
      socket.onclose = () => {
        if (closed) return;
        if (lastSample) onSample({ ...lastSample, receivedAt: Date.now(), stale: true, connection: 'unavailable' });
        reconnect = setTimeout(connect, 2000);
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => { closed = true; if (reconnect) clearTimeout(reconnect); socket?.close(); };
  }
}
