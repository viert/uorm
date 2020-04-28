import debug from 'debug';
import Memcached from 'memcached';

const cacheLogger = debug('uorm:cache');

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
    return (
      key in SimpleCacheAdapter._store &&
      !SimpleCacheAdapter._store[key].expired
    );
  }

  async get(key: string) {
    const item = SimpleCacheAdapter._store[key];
    if (!item) {
      return null;
    }
    if (item.expired) {
      delete SimpleCacheAdapter._store[key];
      return null;
    }
    return item.value;
  }

  async set(key: string, value: any, ttlSec = 600) {
    const item = new ExpirableValue(value, ttlSec);
    SimpleCacheAdapter._store[key] = item;
    return true;
  }

  async delete(key: string) {
    const dt = Date.now();
    if (!(await this.has(key))) return false;
    const item = SimpleCacheAdapter._store[key];
    delete SimpleCacheAdapter._store[key];
    const dt2 = Date.now();
    cacheLogger(`DELETE ${key} ${dt2 - dt}ms`);
    return !item.expired;
  }

  async close() {}
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
    this.memcached = new Memcached(this.backends, this.options);
    return true;
  }

  async get(key: string): Promise<any> {
    return new Promise((resolve, reject) => {
      this.memcached.get(key, (err, data) => {
        if (err) {
          return reject(err);
        }
        resolve(data);
      });
    });
  }

  async set(key: string, value: any, ttlSec: number): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.memcached.set(key, value, ttlSec, (err, result) => {
        if (err) {
          return reject(err);
        }
        resolve(result);
      });
    });
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== undefined;
  }

  async delete(key: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
      this.memcached.del(key, (err, result) => {
        if (err) {
          return reject(err);
        }
        resolve(result);
      });
    });
  }

  async close() {
    this.memcached.end();
  }
}
