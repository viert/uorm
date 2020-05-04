import debug from 'debug';
import Memcached from 'memcached';

const simpleLogger = debug('uorm:cache:simple');
const memcachedLogger = debug('uorm:cache:memcached');

export interface CacheAdapter {
  init(): Promise<boolean>;
  has(key: string): Promise<boolean>;
  get(key: string): Promise<any>;
  set(key: string, value: any, ttlSec: number): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  close(): Promise<void>;
}

class ExpirableValue<T> {
  private expiresAt: number;
  constructor(public value: T, ttlSec: number) {
    this.expiresAt = Date.now() + ttlSec * 1000;
  }
  get expired(): boolean {
    return Date.now() > this.expiresAt;
  }
}

export class SimpleCacheAdapter implements CacheAdapter {
  private static _store: { [key: string]: ExpirableValue<any> } = {};

  async init(): Promise<boolean> {
    return true;
  }

  async has(key: string) {
    let expired = false;
    const hasKey = key in SimpleCacheAdapter._store;
    simpleLogger(`has(${key}): key ${hasKey}`);

    if (hasKey) {
      const expired = SimpleCacheAdapter._store[key].expired;
      if (expired) simpleLogger(`has(${key}) key is expired`);
    }
    return hasKey && !expired;
  }

  async get(key: string) {
    const item = SimpleCacheAdapter._store[key];
    if (!item) {
      simpleLogger(`get(${key}) cache miss`);
      return null;
    }

    if (item.expired) {
      simpleLogger(`get(${key}) item is expired, deleting`);
      delete SimpleCacheAdapter._store[key];
      return null;
    }

    simpleLogger(`get(${key}) cache hit`);
    return item.value;
  }

  async set(key: string, value: any, ttlSec = 600) {
    const item = new ExpirableValue(value, ttlSec);
    simpleLogger(`set(${key}, ${JSON.stringify(value)}, ttl=${ttlSec})`);
    SimpleCacheAdapter._store[key] = item;
    return true;
  }

  async delete(key: string) {
    const dt = Date.now();
    if (!(await this.has(key))) {
      simpleLogger(`delete(${key}) key doesn't exist`);
      return false;
    }

    const item = SimpleCacheAdapter._store[key];
    delete SimpleCacheAdapter._store[key];

    const dt2 = Date.now();
    simpleLogger(`delete(${key}) ${dt2 - dt}ms`);

    return !item.expired;
  }

  async close() {
    simpleLogger('close()');
  }
}

export class MemcachedCacheAdapter implements CacheAdapter {
  private memcached: Memcached;

  constructor(
    private backends: string[],
    private options: { [key: string]: any } = {}
  ) {
    if (!this.backends || this.backends.length === 0) {
      throw new Error(
        'Configuration error, backends is mandatory for memcached-based cache'
      );
    }
  }

  async init(): Promise<boolean> {
    memcachedLogger('initializing memcached connection');
    this.memcached = new Memcached(this.backends, this.options);
    return true;
  }

  async get(key: string): Promise<any> {
    return new Promise((resolve, reject) => {
      memcachedLogger(`running memcached.get(${key})`);
      this.memcached.get(key, (err, data) => {
        if (err) {
          memcachedLogger(`get(${key}): ${err}`);
          return reject(err);
        }
        memcachedLogger(`get(${key}) cache hit`);
        resolve(data);
      });
    });
  }

  async set(key: string, value: any, ttlSec: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      memcachedLogger(
        `running memcached.set(${key}, ${JSON.stringify(value)}, ttl=${ttlSec})`
      );
      this.memcached.set(key, value, ttlSec, (err, result) => {
        if (err) {
          memcachedLogger(`set(${key}) error: ${err}`);
          return reject(err);
        }
        memcachedLogger(`set(${key}) succeed`);
        resolve(result);
      });
    });
  }

  async has(key: string): Promise<boolean> {
    memcachedLogger(`has(${key})`);
    return (await this.get(key)) !== undefined;
  }

  async delete(key: string): Promise<boolean> {
    memcachedLogger(`running memcached.delete(${key})`);
    return new Promise((resolve, reject) => {
      this.memcached.del(key, (err, result) => {
        if (err) {
          memcachedLogger(`delete(${key}) error: ${err}`);
          return reject(err);
        }
        memcachedLogger(`delete(${key}) succeed`);
        resolve(result);
      });
    });
  }

  async close() {
    memcachedLogger('close()');
    this.memcached.end();
  }
}
