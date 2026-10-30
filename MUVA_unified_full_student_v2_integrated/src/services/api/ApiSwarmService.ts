import axios from 'axios';
import type { SwarmConfig, SwarmDrone, SwarmMission, SwarmMissionReceipt, SwarmSnapshot } from '../../types/swarm';
import type { SwarmService } from '../swarmContract';

export class ApiSwarmService implements SwarmService {
  readonly mode = 'sitl' as const;
  readonly label = 'Gazebo · ArduPilot SITL';
  private readonly client = axios.create({ baseURL: import.meta.env.VITE_SWARM_API_BASE_URL ?? 'http://127.0.0.1:8002/api/swarm', timeout: 180_000 });
  private snapshot: SwarmSnapshot = { status: 'DRAFT', drones: [], elapsed: 0, events: [], coverage: 0 };
  private missions: SwarmMission[] = [];
  private listeners = new Set<(snapshot: SwarmSnapshot) => void>();
  private socket: WebSocket | null = null;
  private retry: ReturnType<typeof setTimeout> | undefined;
  private sessionId: string | null = null;
  private revision = 0;
  private candidatePending = false;

  constructor() {
    this.client.interceptors.response.use(response => response, (error: unknown) => {
      if (axios.isAxiosError(error)) {
        const detail: unknown = (error.response?.data as { detail?: unknown } | undefined)?.detail;
        return Promise.reject(new Error(typeof detail === 'string' ? detail : '实验二 SITL 服务未连接，请启动独立实验二后端'));
      }
      return Promise.reject(error);
    });
  }

  async initialize(config: SwarmConfig): Promise<SwarmSnapshot> {
    const revision = ++this.revision;
    this.disconnect();
    const { data } = await this.client.post<SwarmSnapshot>('/configure', { config: { ...config, simulationMode: this.mode } }, { timeout: 420_000 });
    if (revision !== this.revision) throw new Error('初始化结果已过期，请重新连接机群');
    this.sessionId = data.runtime?.sessionId ?? null;
    this.missions = [];
    this.candidatePending = false;
    this.receive(data);
    this.connect();
    return this.getStatus();
  }

  async restore(config: SwarmConfig, missions: SwarmMission[], snapshot: SwarmSnapshot): Promise<SwarmSnapshot> {
    if (config.simulationMode !== 'sitl' || !snapshot.runtime?.sessionId) throw new Error('此进度不属于当前 SITL 会话，请重新初始化；不会把 Mock 飞行状态发送给真实飞控');
    this.sessionId = snapshot.runtime.sessionId;
    const { data } = await this.client.get<SwarmSnapshot>('/status', { params: { sessionId: this.sessionId } });
    this.missions = structuredClone(missions);
    this.candidatePending = data.missionPlanId !== snapshot.missionPlanId;
    this.receive(data);
    this.connect();
    return this.getStatus();
  }

  loadMission(missions: SwarmMission[]): void {
    if (this.snapshot.drones.some(drone => drone.armed)) throw new Error('已解锁时不能修改任务');
    this.missions = structuredClone(missions);
    this.candidatePending = true;
    this.snapshot = { ...this.snapshot, status: missions.length ? 'PLANNED' : 'DRAFT', missionPlanId: undefined, missionReceipts: [] };
  }

  async uploadMission(missions: SwarmMission[], planId: string): Promise<SwarmMissionReceipt[]> {
    if (JSON.stringify(missions) !== JSON.stringify(this.missions)) throw new Error('下发航线与当前候选计划不匹配');
    const { data } = await this.client.post<SwarmSnapshot>('/missions', { sessionId: this.requireSession(), planId, missions });
    this.candidatePending = false;
    this.receive(data);
    return data.missionReceipts ?? [];
  }

  private requireSession(): string {
    if (!this.sessionId) throw new Error('尚未连接后端实际机群，请先初始化');
    return this.sessionId;
  }

  private async command(action: string, droneId?: string): Promise<void> {
    const { data } = await this.client.post<SwarmSnapshot>('/command', { sessionId: this.requireSession(), action, droneId });
    this.receive(data);
  }

  markReady(): Promise<void> { return this.command('ready'); }
  takeoff(): Promise<void> { return this.command('takeoff'); }
  startMission(): Promise<void> { return this.command('startMission'); }
  pauseMission(): Promise<void> { return this.command('pauseMission'); }
  resumeMission(): Promise<void> { return this.command('resumeMission'); }
  returnToHome(): Promise<void> { return this.command('returnToHome'); }
  returnDroneToHome(droneId: string): Promise<void> { return this.command('returnDroneToHome', droneId); }
  getFleet(): SwarmDrone[] { return this.getStatus().drones; }
  getStatus(): SwarmSnapshot { return structuredClone(this.snapshot); }
  stop(): void { this.disconnect(); }
  async shutdown(sessionId?: string): Promise<void> {
    const localSession = sessionId ?? this.sessionId;
    const { data: health } = await this.client.get<{ sessionId: string | null }>('/health');
    if (health.sessionId !== null && typeof health.sessionId !== 'string') {
      throw new Error('后端机群会话状态无效，未关闭机群');
    }

    const backendSession = health.sessionId;
    if (backendSession) {
      if (backendSession !== localSession) {
        const { data: status } = await this.client.get<SwarmSnapshot>('/status', { params: { sessionId: backendSession } });
        const fleetIsGrounded = Array.isArray(status.drones) && status.drones.length > 0 && status.drones.every(drone =>
          drone.connected === true && drone.armed === false && Number.isFinite(drone.altitude) && drone.altitude < 0.8);
        if (!fleetIsGrounded) throw new Error('后端当前机群与本地进度不一致，且无法确认全部飞控在线、上锁并落地；为安全起见未关闭机群');
      }
      await this.client.post('/shutdown', { sessionId: backendSession, action: 'shutdown' });
    }

    this.revision += 1;
    this.disconnect();
    this.sessionId = null;
    this.missions = [];
    this.candidatePending = false;
  }
  async abortSimulation(sessionId?: string): Promise<void> {
    const localSession = sessionId ?? this.sessionId;
    const { data: health } = await this.client.get<{ sessionId: string | null }>('/health');
    const backendSession = health.sessionId;
    if (backendSession !== null && typeof backendSession !== 'string') throw new Error('后端机群会话状态无效，未执行中止');
    if (backendSession) {
      await this.client.post('/abort-simulation', { sessionId: backendSession, confirmed: true });
    }
    this.revision += 1;
    this.disconnect();
    if (!localSession || localSession === backendSession || !backendSession) this.sessionId = null;
    this.missions = [];
    this.candidatePending = false;
  }
  dispose(): void { this.revision += 1; this.disconnect(); this.listeners.clear(); }

  subscribeTelemetry(listener: (snapshot: SwarmSnapshot) => void): () => void {
    this.listeners.add(listener);
    this.connect();
    return () => { this.listeners.delete(listener); if (!this.listeners.size) this.disconnect(); };
  }

  private receive(snapshot: SwarmSnapshot): void {
    this.snapshot = structuredClone(this.candidatePending && !snapshot.drones.some(drone => drone.armed)
      ? { ...snapshot, status: this.missions.length ? 'PLANNED' : 'DRAFT', missionPlanId: undefined, missionReceipts: [] } : snapshot);
    this.listeners.forEach(listener => listener(this.getStatus()));
  }

  private connect(): void {
    if (!this.sessionId || this.socket || !this.listeners.size) return;
    const url = new URL(import.meta.env.VITE_SWARM_WS_URL ?? 'ws://127.0.0.1:8002/ws/swarm');
    url.searchParams.set('sessionId', this.sessionId);
    const socket = new WebSocket(url);
    this.socket = socket;
    socket.onmessage = event => {
      try {
        const value: unknown = JSON.parse(String(event.data));
        if (typeof value === 'object' && value !== null && 'drones' in value && Array.isArray(value.drones) && 'runtime' in value) this.receive(value as SwarmSnapshot);
      } catch { this.connectionLost('后端遥测格式无效'); }
    };
    socket.onclose = event => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.connectionLost(event.code === 1008 ? '机群会话失效，请重新初始化' : '实验二遥测断开；后端飞行未被本地暂停，请重新连接');
      if (event.code !== 1008 && this.listeners.size) this.retry = setTimeout(() => this.connect(), 1500);
    };
    socket.onerror = () => this.connectionLost('实验二遥测连接异常');
  }

  private connectionLost(error: string): void {
    this.receive({ ...this.snapshot, drones: this.snapshot.drones.map(drone => ({ ...drone, connected: false })),
      runtime: { sessionId: this.sessionId, mode: this.mode, label: this.label, connected: false, error } });
  }

  private disconnect(): void {
    clearTimeout(this.retry);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }
}
