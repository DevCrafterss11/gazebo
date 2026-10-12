import { useEffect, useRef } from 'react';
import { services } from '../../../../services/serviceRegistry';
import type { SwarmSnapshot } from '../../../../types/swarm';

/**
 * 管理 Swarm Service 的订阅和生命周期
 * 将 Service 管理从 Store 中分离，符合单一职责原则
 */
export function useSwarmRuntime(
  onSnapshot: (snapshot: SwarmSnapshot) => void,
  enabled: boolean = true
) {
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled) {
      // 清理现有订阅
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      return;
    }

    // 订阅遥测数据
    unsubscribeRef.current = services.swarm.subscribeTelemetry(onSnapshot);

    // 组件卸载时清理
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [onSnapshot, enabled]);

  return {
    service: services.swarm,
    dispose: () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      services.swarm.dispose();
    },
  };
}
