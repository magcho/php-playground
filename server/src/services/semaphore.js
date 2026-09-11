/**
 * Simple in-process semaphore with bounded wait queue.
 */
export class Semaphore {
  /**
   * @param {number} maxConcurrent
   * @param {number} maxQueued
   */
  constructor(maxConcurrent, maxQueued) {
    this.maxConcurrent = Math.max(1, maxConcurrent);
    this.maxQueued = Math.max(0, maxQueued);
    this.active = 0;
    this.queue = [];
  }

  /**
   * Acquire a slot. Throws if the wait queue is full.
   * @returns {Promise<() => void>} release function
   */
  acquire() {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return Promise.resolve(() => this.release());
    }
    if (this.queue.length >= this.maxQueued) {
      const err = new Error('runner is at capacity');
      err.code = 'RUNNER_BUSY';
      return Promise.reject(err);
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
    });
  }

  release() {
    const next = this.queue.shift();
    if (next) {
      next.resolve(() => this.release());
      return;
    }
    this.active = Math.max(0, this.active - 1);
  }

  snapshot() {
    return {
      active: this.active,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      maxQueued: this.maxQueued,
    };
  }
}
