/**
 * 极简 FIFO 异步互斥锁。JSON 仓库没有数据库事务，
 * 所以会话写操作需要串行化，避免并发保存互相覆盖。
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
