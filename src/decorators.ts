import debug from 'debug';
import { db } from './db';
import crypto from 'crypto';

const cacheLogger = debug('uorm:cache');

export function createKey(
  prefix: string,
  funcName: string,
  args: any[]
): string {
  let argsHash = '';
  if (args.length) {
    const hash = crypto.createHash('md5');
    args.forEach(arg => {
      hash.update(arg.toString());
    });
    argsHash = hash.digest('hex');
  }
  return `${prefix}.${funcName}(${argsHash})`;
}

export function CachedMethod(prefix: string = 'cf', ttlSec: number = -1) {
  return function __decorate(
    target: any,
    propertyName: string,
    descriptor: PropertyDescriptor
  ) {
    const targetName =
      target.constructor.name === 'Function'
        ? `${target.name}#static`
        : target.constructor.name;
    if (
      descriptor.value &&
      descriptor.value.constructor.name === 'AsyncFunction'
    ) {
      const origFunc = descriptor.value;
      descriptor.value = async function __decorated(
        ...args: any[]
      ): Promise<any> {
        const dt = Date.now();
        const cache = db.cache;
        const cacheKey = createKey(
          prefix,
          `${targetName}.${propertyName}`,
          args
        );

        const cachedResult = await cache.get(cacheKey);
        if (cachedResult) {
          const dt2 = Date.now();
          cacheLogger(`HIT ${cacheKey} ${dt2 - dt}ms`);
          return cachedResult;
        }

        const result = await origFunc.apply(this, args);

        if (ttlSec < 0) ttlSec = db.cacheTTL;
        await cache.set(cacheKey, result, ttlSec);

        const dt2 = Date.now();
        cacheLogger(`MISS ${cacheKey} ${dt2 - dt}ms`);
        return result;
      };
    } else {
      throw new Error('CachedMethod can only decorate async methods');
    }
  };
}
