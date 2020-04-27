import { initDatabases } from './util';
import { db, CachedMethod, StorableModel, StringField, Nullable } from '../src';
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

  it('should cache models with cacheGet', async () => {
    class MyModel extends StorableModel {
      @StringField() field1: string;

      static __key_field__ = 'field1';

      static count = 0;
      static async get<T extends typeof StorableModel>(expression: any) {
        this.count++;
        const result = await super.get(expression);
        return result as Nullable<InstanceType<T>>;
      }
    }

    await MyModel.make({ field1: 'hello' }).save();

    let r = await MyModel.cacheGet('hello');
    assert.strictEqual(MyModel.count, 1);
    assert.strictEqual(r!.field1, 'hello');

    r = await MyModel.cacheGet('hello');
    assert.strictEqual(MyModel.count, 1);
    assert.strictEqual(r!.field1, 'hello');

    r = await MyModel.cacheGet(r!._id);
    assert.strictEqual(MyModel.count, 2);
    assert.strictEqual(r!.field1, 'hello');

    r = await MyModel.cacheGet(r!._id);
    assert.strictEqual(MyModel.count, 2);
    assert.strictEqual(r!.field1, 'hello');

    await r!.invalidate();
    r = await MyModel.cacheGet(r!._id);
    assert.strictEqual(MyModel.count, 3);
    assert.strictEqual(r!.field1, 'hello');

    r = await MyModel.cacheGet('hello');
    assert.strictEqual(MyModel.count, 4);
    assert.strictEqual(r!.field1, 'hello');
  });
});
