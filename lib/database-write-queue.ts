/** SQLite's native driver is synchronous. Serialize writers so one connection
 * cannot block the JS continuation that must release another connection's lock. */
export class DatabaseWriteBusyError extends Error {
  readonly code = "DATABASE_WRITE_BUSY";
  constructor() { super("The auction server is busy. Your request was not started; please try again shortly."); }
}

export function createDatabaseWriteQueue(options: { maxQueueWaitMs?: number; maxPending?: number } = {}) {
  let tail = Promise.resolve();
  let pending = 0;
  const maxQueueWaitMs = options.maxQueueWaitMs ?? 5000;
  const maxPending = options.maxPending ?? 32;
  return function runWrite<Transaction, Result>(
    begin: (work: (transaction: Transaction) => Promise<Result>) => Promise<Result>,
    work: (transaction: Transaction) => Promise<Result>,
    recoverAfterLock?: () => Promise<void>,
  ): Promise<Result> {
    if (pending >= maxPending) return Promise.reject(new DatabaseWriteBusyError());
    pending += 1;
    const queuedAt = Date.now();
    let expired = false;
    let timeout: ReturnType<typeof setTimeout>;
    const waiting = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => { expired = true; reject(new DatabaseWriteBusyError()); }, maxQueueWaitMs);
    });
    const result = tail.then(async () => {
      clearTimeout(timeout);
      // A timed-out queued request must never mutate later in the background.
      if (expired || Date.now() - queuedAt >= maxQueueWaitMs) throw new DatabaseWriteBusyError();
      for (let attempt = 0; ; attempt += 1) {
        let started = false;
        try {
          return await begin(async transaction => {
            started = true;
            return work(transaction);
          });
        } catch (error) {
          // The local native driver can retain an unfinished BEGIN statement
          // after SQLITE_BUSY. Reusing that connection then poisons every COMMIT.
          // Recovery must touch a dedicated writer connection, never read traffic.
          if (isDatabaseLock(error) && recoverAfterLock) await recoverAfterLock();
          // Retrying an ambiguous commit could double-charge a purse. Only a
          // failed BEGIN, before any callback work ran, can be safely repeated.
          if (started || attempt >= 7 || !isDatabaseLock(error)) throw error;
          await new Promise(resolve => setTimeout(resolve, Math.min(25 * 2 ** attempt, 300)));
        }
      }
    }).finally(() => { pending -= 1; clearTimeout(timeout); });
    tail = result.then(() => undefined, () => undefined);
    return Promise.race([result, waiting]);
  };
}

function isDatabaseLock(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    const value = current as { code?: unknown; cause?: unknown };
    if (typeof value.code === "string" && /^(SQLITE_BUSY|SQLITE_LOCKED)(?:_|$)/.test(value.code)) return true;
    current = value.cause;
  }
  return false;
}
