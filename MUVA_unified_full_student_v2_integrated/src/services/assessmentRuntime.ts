import { services } from './serviceRegistry';

export async function assertAssessmentResourceAvailable(): Promise<void> {
  if (services.dataSource === 'api') {
    throw new Error('Gateway 尚无跨实验会话资源锁；当前禁止实验三接管真实 SITL。请先实现并验证后端原子租约与所有权检查。');
  }
  const runtime = await services.environment.getStatus();
  if (runtime.gazebo !== 'STOPPED' || runtime.ardupilotSitl !== 'STOPPED' || runtime.mavlinkGateway !== 'DISCONNECTED' || services.flight.getState()?.connected) {
    throw new Error('仿真资源已有进程运行，无法确认所有者；拒绝抢占');
  }
}

export function canReleaseStaleMockLease(): boolean {
  return services.dataSource === 'mock' && services.flight.getState()?.connected === false;
}
