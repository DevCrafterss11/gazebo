import type { PreflightChecklistItem, SensorCheckItem } from '../types/configuration';
import type { ExperimentProgressEvent } from '../types/experiment';

export function waitForCheck(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('检查已取消', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export async function showCheckSequence<Item extends SensorCheckItem | PreflightChecklistItem>(
  results: Item[], onUpdate: (items: Item[]) => void,
  type: ExperimentProgressEvent['type'], milliseconds: number,
  onProgress?: (event: ExperimentProgressEvent) => void, signal?: AbortSignal,
): Promise<Item[]> {
  const snapshot = (item: Item, status: Item['status']): Item => ({ ...item, status,
    ...('details' in item ? { details: status === 'WAITING' ? ['待检查'] : status === 'CHECKING' ? ['正在读取飞控检查结果…'] : [...item.details] }
      : { reason: status === 'WAITING' || status === 'CHECKING' ? undefined : item.reason }),
  });
  const items = results.map((item) => snapshot(item, 'WAITING'));
  onUpdate(items.map((item) => ({ ...item })));
  for (const [index, result] of results.entries()) {
    signal?.throwIfAborted();
    const step = 'name' in result ? result.name : result.label;
    items[index] = snapshot(result, 'CHECKING');
    onProgress?.({ type, step, status: 'checking' });
    onUpdate(items.map((item) => ({ ...item })));
    await waitForCheck(milliseconds, signal);
    items[index] = snapshot(result, result.status);
    onProgress?.({ type, step, status: result.status === 'PASS' ? 'pass' : 'fail' });
    onUpdate(items.map((item) => ({ ...item })));
  }
  return items;
}
