import { CircleDot, Cpu } from 'lucide-react';
import { useLocation } from 'react-router-dom';

import { services as serviceRegistry } from '../../../../services/serviceRegistry';
import { useEnvironmentStore } from '../../../../stores/environmentStore';
import { usePlatformUiStore } from '../../../../stores/platformUiStore';
import styles from './Panels.module.css';

export function EnvironmentStatus() {
  const { pathname } = useLocation();
  const runtime = useEnvironmentStore((state) => state.runtime);
  const openEnvironment = usePlatformUiStore((state) => state.openEnvironment);
  const isolatedMock = pathname.startsWith('/experiments/swarm') && serviceRegistry.swarm.mode === 'mock';
  const services = [
    { id: 'gazebo', label: 'Gazebo 仿真环境', status: runtime.gazebo, description: '模拟三维物理环境' },
    { id: 'sitl', label: 'ArduPilot SITL', status: runtime.ardupilotSitl, description: '软件在环飞控模拟器' },
    { id: 'mavlink', label: 'MAVLink Gateway', status: runtime.mavlinkGateway, description: '前端与飞控之间的消息网关' },
  ];

  return (
    <button className={styles.environmentPanel} type="button" onClick={openEnvironment} aria-label="查看仿真环境详细状态">
      <span className={styles.environmentHeader}><Cpu size={17} /><span>仿真环境状态</span></span>
      <span className={styles.environmentRows}>
        {isolatedMock ? <span className={styles.environmentRow} title="实验二使用独立前端模拟运行时，不连接 Gazebo、SITL 或真实飞控。">
          <span>实验二运行时</span>
          <span className={`${styles.environmentState} ${styles.environmentStateIdle}`}><CircleDot size={10} />Mock 隔离</span>
        </span> : services.map((service) => (
          <span className={styles.environmentRow} key={service.id} title={service.description}>
            <span>{service.label}</span>
            <span className={`${styles.environmentState} ${service.status === 'RUNNING' || service.status === 'CONNECTED' ? '' : styles.environmentStateIdle}`}>
              <CircleDot size={10} />
              {service.status === 'CONNECTED'
                ? '已连接'
                : service.status === 'RUNNING'
                  ? '运行中'
                  : service.status === 'STARTING' || service.status === 'CONNECTING'
                    ? '启动中'
                    : '已停止'}
            </span>
          </span>
        ))}
      </span>
    </button>
  );
}
