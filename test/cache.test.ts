import { initDatabases } from './util';
import { db, CachedMethod } from '../src';
import { createKey } from '../src/cache';
import * as assert from 'assert';

describe('cache', () => {
  beforeAll(async done => {
    await initDatabases();
    done();
  });

  afterAll(async done => {
    await db
      .meta()
      .db()
      .dropDatabase();
    for (const shardId in db.shards()) {
      await db
        .getShard(shardId)
        .db()
        .dropDatabase();
    }
    done();
  });

  it('should call cached method only once', async () => {
    class TestCase {
      public count: number;

      constructor() {
        this.count = 0;
      }

      @CachedMethod()
      async incAndReturn() {
        this.count++;
        return this.count;
      }
    }

    const tc = new TestCase();
    assert.strictEqual(tc.count, 0);

    let res = await tc.incAndReturn();
    assert.strictEqual(tc.count, 1);
    assert.strictEqual(res, 1);

    res = await tc.incAndReturn();
    assert.strictEqual(tc.count, 1);
    assert.strictEqual(res, 1);

    const key = createKey('cf', 'TestCase.incAndReturn', []);
    await db.cache.delete(key);

    res = await tc.incAndReturn();
    assert.strictEqual(tc.count, 2);
    assert.strictEqual(res, 2);
  });
});
