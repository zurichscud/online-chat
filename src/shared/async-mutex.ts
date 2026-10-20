/**
 * Minimal FIFO async mutex. The JSON repository has no database transactions,
 * so chat write operations are serialized to prevent lost updates. A MySQL
 * repository will rely on transactions/row locks instead.
 */
export class AsyncMutex {
  private queue: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task);
    this.queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}
