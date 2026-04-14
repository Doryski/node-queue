import type { QueuedProcess } from "./types.js";

/**
 * Simple FIFO queue for managing pending processes
 */
export function createProcessQueue(maxSize: number) {
  const queue: QueuedProcess[] = [];

  const enqueue = (process: QueuedProcess): boolean => {
    if (queue.length >= maxSize) {
      return false; // Queue full
    }
    queue.push(process);
    return true;
  };

  const dequeue = (): QueuedProcess | undefined => {
    return queue.shift();
  };

  const peek = (): QueuedProcess | undefined => {
    return queue[0];
  };

  const remove = (id: string): QueuedProcess | undefined => {
    const index = queue.findIndex((p) => p.id === id);
    if (index === -1) return undefined;
    return queue.splice(index, 1)[0];
  };

  const getPosition = (id: string): number => {
    const index = queue.findIndex((p) => p.id === id);
    return index === -1 ? -1 : index + 1; // 1-based position
  };

  const size = (): number => queue.length;

  const isEmpty = (): boolean => queue.length === 0;

  const isFull = (): boolean => queue.length >= maxSize;

  const getAll = (): QueuedProcess[] => [...queue];

  const clear = (): void => {
    queue.length = 0;
  };

  return {
    enqueue,
    dequeue,
    peek,
    remove,
    getPosition,
    size,
    isEmpty,
    isFull,
    getAll,
    clear,
  };
}

export type ProcessQueue = ReturnType<typeof createProcessQueue>;
