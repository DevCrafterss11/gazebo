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

const getDirectionClass = (direction: string): string => {
  if (direction === 'TX') return styles.terminalTx ?? '';
  if (direction === 'RX') return styles.terminalRx ?? '';
  return styles.terminalLocal ?? '';
};

export function MavlinkMonitorPanel() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
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
    if (terminal && followLatestRef.current) terminal.scrollTop = terminal.scrollHeight;
  }, [latestEntryId]);

  const handleScroll = () => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const distanceFromBottom = terminal.scrollHeight - terminal.scrollTop - terminal.clientHeight;
    followLatestRef.current = distanceFromBottom <= 12;
  };

  return (
    <PanelShell
      title="MAVLink 监视终端"
      icon={Terminal}
      action={<span className={connected ? styles.terminalConnected : styles.terminalDisconnected}>{connected ? 'LIVE' : connectionState === 'connecting' ? '连接中' : '断开'}</span>}
      emphasis="secondary"
    >
      <div className={styles.terminalSummary}><span><i className={styles.terminalTx}>TX</i> 平台下发 · <i className={styles.terminalRx}>RX</i> 飞控返回</span><strong>{packetCount.toLocaleString()} RX packets</strong></div>
      <div className={styles.mavlinkTerminal} role="log" aria-live="polite" ref={terminalRef} onScroll={handleScroll}>
        {entries.length === 0 ? <span className={styles.terminalEmpty}>等待 MAVLink 消息...</span> : (
          <div className={styles.terminalLines}>
            {entries.map((entry) => (
              <div className={`${styles.terminalLine} ${getSeverityClass(entry.severity)}`} key={entry.id}>
                <time>{formatTime(entry.timestamp)}</time>
                <i className={getDirectionClass(entry.direction ?? 'RX')}>{entry.direction ?? 'RX'}</i>
                <small>{entry.sourceSystem}:{entry.sourceComponent}</small>
                <b>{entry.type}</b>
                <span>{entry.text}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </PanelShell>
  );
}
