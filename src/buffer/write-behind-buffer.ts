// Generic in-memory write-behind buffer. The caller enqueues an item and
// returns to its client at once; a flush writes buffered items to Postgres in
// batches through the supplied write function.
//
// - Flush when the buffer holds batchSize entries, or every flushIntervalMs
//   for whatever is left.
// - Items are deduped by key while buffered.
// - pending + in-flight is capped at cap; past that, enqueue refuses.
// - A failed write is retried MAX_RETRIES times, then the batch is dropped.
// - State is per process (each cluster worker has its own buffer), and
//   buffered items are lost if the process dies without a shutdown flush.

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 50;

export type EnqueueResult = "queued" | "full";

export type BufferStats = {
  pending: number;
  inFlight: number;
  highWaterMark: number;
  enqueued: number;
  dedupedInBuffer: number;
  cancelled: number; // removed from the buffer before being written
  rejectedFull: number;
  batchesFlushed: number;
  inserted: number;
  skipped: number; // already existed, or a referenced row no longer exists
  retries: number;
  batchesDropped: number;
  itemsDropped: number;
  lastFlushMs: number;
  maxFlushMs: number;
};

export type WriteBehindOptions<T> = {
  name: string;
  batchSize: number;
  flushIntervalMs: number;
  cap: number;
  keyOf: (item: T) => string;
  // Writes one batch and returns how many rows were actually inserted.
  write: (batch: T[]) => Promise<number>;
  // Runs after a batch was written successfully.
  onWritten?: (batch: T[]) => void;
};

export type WriteBehindBuffer<T> = {
  enqueue: (item: T) => EnqueueResult;
  // Removes a still-buffered item; false if it isn't pending (not buffered,
  // or already in flight to the DB).
  remove: (item: T) => boolean;
  shutdown: () => Promise<void>;
  getStats: () => BufferStats;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createWriteBehindBuffer<T>(
  options: WriteBehindOptions<T>,
): WriteBehindBuffer<T> {
  const { name, batchSize, flushIntervalMs, cap, keyOf, write, onWritten } =
    options;

  const pending = new Map<string, T>();
  let inFlight = 0;
  let flushing = false;
  let timer: NodeJS.Timeout | undefined;

  const stats = {
    highWaterMark: 0,
    enqueued: 0,
    dedupedInBuffer: 0,
    cancelled: 0,
    rejectedFull: 0,
    batchesFlushed: 0,
    inserted: 0,
    skipped: 0,
    retries: 0,
    batchesDropped: 0,
    itemsDropped: 0,
    lastFlushMs: 0,
    maxFlushMs: 0,
  };

  async function writeBatch(batch: T[]): Promise<void> {
    const startedAt = performance.now();

    for (let attempt = 0; ; attempt += 1) {
      try {
        const inserted = await write(batch);
        const elapsed = performance.now() - startedAt;
        stats.batchesFlushed += 1;
        stats.inserted += inserted;
        stats.skipped += batch.length - inserted;
        stats.lastFlushMs = elapsed;
        stats.maxFlushMs = Math.max(stats.maxFlushMs, elapsed);
        try {
          onWritten?.(batch);
        } catch (error) {
          console.error(`[${name}-buffer] onWritten failed:`, error);
        }
        return;
      } catch (error) {
        if (attempt >= MAX_RETRIES) {
          stats.batchesDropped += 1;
          stats.itemsDropped += batch.length;
          console.error(
            `[${name}-buffer] dropping ${batch.length} items after ${attempt + 1} attempts:`,
            error,
          );
          return;
        }
        stats.retries += 1;
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }

  // Writes buffered items in chunks of batchSize while at least minSize
  // entries are pending. Only one flush runs at a time per process.
  async function flush(minSize: number): Promise<void> {
    if (flushing) {
      return;
    }

    flushing = true;
    try {
      while (pending.size > 0 && pending.size >= minSize) {
        const batch: T[] = [];
        for (const [key, item] of pending) {
          batch.push(item);
          pending.delete(key);
          if (batch.length >= batchSize) {
            break;
          }
        }

        inFlight = batch.length;
        try {
          await writeBatch(batch);
        } finally {
          inFlight = 0;
        }
      }
    } finally {
      flushing = false;
    }
  }

  function ensureTimer(): void {
    if (timer) {
      return;
    }
    timer = setInterval(() => {
      void flush(1);
    }, flushIntervalMs);
    timer.unref();
  }

  function enqueue(item: T): EnqueueResult {
    const key = keyOf(item);

    if (pending.has(key)) {
      stats.dedupedInBuffer += 1;
      return "queued";
    }

    if (pending.size + inFlight >= cap) {
      stats.rejectedFull += 1;
      return "full";
    }

    ensureTimer();
    pending.set(key, item);
    stats.enqueued += 1;
    stats.highWaterMark = Math.max(
      stats.highWaterMark,
      pending.size + inFlight,
    );

    if (pending.size >= batchSize) {
      void flush(batchSize);
    }
    return "queued";
  }

  function remove(item: T): boolean {
    const removed = pending.delete(keyOf(item));
    if (removed) {
      stats.cancelled += 1;
    }
    return removed;
  }

  // Stops the timer and writes everything still buffered. Used on shutdown.
  async function shutdown(): Promise<void> {
    if (timer) {
      clearInterval(timer);
      timer = undefined;
    }

    // An in-progress flush finishes its loop; then drain whatever remains.
    while (flushing) {
      await sleep(10);
    }
    await flush(1);
  }

  function getStats(): BufferStats {
    return { pending: pending.size, inFlight, ...stats };
  }

  return { enqueue, remove, shutdown, getStats };
}
