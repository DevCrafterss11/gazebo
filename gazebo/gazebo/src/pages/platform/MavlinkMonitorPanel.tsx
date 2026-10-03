import { Terminal } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { PanelShell } from '../../components/common/PanelShell/PanelShell';
import { useMavlinkMonitorStore } from '../../stores/mavlinkMonitorStore';
import styles from './PlatformPages.module.css';

const formatTime = (timestamp: number): string => new Date(timestamp * 1000).toLocaleTimeString('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

const getSeverityClass = (severity: string): string => {
  if (!severity) return '';
  const className = `terminal${severity.charAt(0).toUpperCase()}${severity.slice(1)}`;
  return styles[className] ?? '';
};

export function MavlinkMonitorPanel() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const entries = useMavlinkMonitorStore((state) => state.entries);
  const packetCount = useMavlinkMonitorStore((state) => state.packetCount);
  const connected = useMavlinkMonitorStore((state) => state.connected);
  const connectionState = useMavlinkMonitorStore((state) => state.connectionState);
  const connect = useMavlinkMonitorStore((state) => state.connect);
  const disconnect = useMavlinkMonitorStore((state) => state.disconnect);

  useEffect(() => {
    connect();
    return disconnect;
  }, [connect, disconnect]);

  const latestEntryId = entries.at(-1)?.id;
  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) terminal.scrollTop = terminal.scrollHeight;
  }, [latestEntryId]);

  return (
    <PanelShell
      title="MAVLink 监视终端"
      icon={Terminal}
      action={<span className={connected ? styles.terminalConnected : styles.terminalDisconnected}>{connected ? 'LIVE' : connectionState === 'connecting' ? '连接中' : '断开'}</span>}
      emphasis="secondary"
    >
      <div className={styles.terminalSummary}><span>只读监视</span><strong>{packetCount.toLocaleString()} packets</strong></div>
      <div className={styles.mavlinkTerminal} role="log" aria-live="polite" ref={terminalRef}>
        {entries.length === 0 ? <span className={styles.terminalEmpty}>等待 MAVLink 消息...</span> : entries.slice(-120).map((entry) => (
          <div className={`${styles.terminalLine} ${getSeverityClass(entry.severity)}`} key={entry.id}>
            <time>{formatTime(entry.timestamp)}</time>
            <b>{entry.type}</b>
            <span>{entry.text}</span>
          </div>
        ))}
      </div>
    </PanelShell>
  );
}
