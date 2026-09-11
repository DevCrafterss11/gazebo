import { Database, Gauge, Info, MonitorCog, Settings } from 'lucide-react';

import { useSystemStore } from '../../stores/systemStore';
import styles from './PlatformPages.module.css';

export function SettingsPage() {
  const dataSource = useSystemStore((state) => state.dataSource);
  const interfaceVersion = useSystemStore((state) => state.interfaceVersion);
  const telemetryRefreshRate = useSystemStore((state) => state.telemetryRefreshRate);
  const simulationMode = useSystemStore((state) => state.simulationMode);
  const settings = [
    { title: '数据源状态', detail: '数据源只在 Service Registry / Composition Root 中选择，页面不直接判断实现类型。', value: dataSource.toUpperCase(), icon: Database },
    { title: '界面信息', detail: 'MUVA 深蓝科技风桌面教学界面。', value: interfaceVersion, icon: MonitorCog },
    { title: '遥测刷新频率', detail: '由当前 TelemetryService 的传输模式决定。', value: telemetryRefreshRate, icon: Gauge },
    { title: '仿真模式说明', detail: '真实模式将通过后端 Gateway 连接 ArduPilot SITL 与 Gazebo。', value: simulationMode, icon: Info },
  ] as const;
  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div><h1>系统设置</h1><p>当前版本提供只读运行信息，避免在页面层耦合具体服务实现。</p></div>
        <span><Settings size={16} />只读配置</span>
      </header>
      <section className={styles.panel}>
        <div className={styles.settingsList}>
          {settings.map(({ title, detail, value, icon: Icon }) => (
            <div className={styles.settingRow} key={title}>
              <div><span><Icon size={14} /> {title}</span><small>{detail}</small></div><strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
