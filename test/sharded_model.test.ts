import { db, ShardedModel, Field } from '../src';
import { initDatabases } from './util';
import { Cursor } from 'mongodb';

const DEFAULT_CALLABLE_VALUE: number = 4;

function callable(): number {
  return DEFAULT_CALLABLE_VALUE;
}

class TestModel extends ShardedModel {
  @Field({ defaultValue: 'default_value', rejected: true }) field1: string;
  @Field({ required: true }) field2: string;
  @Field({ defaultValue: 'required_default_value', required: true })
  field3: string;
  @Field({ defaultValue: callable }) callable_default_field: number;
}

describe('sharded model', () => {
  beforeAll(async done => {
    await initDatabases();
    done();
  });

  afterAll(async done => {
    await db.meta.db.dropDatabase();
    for (const shardId in db.shards) {
      await db.getShard(shardId).db.dropDatabase();
    }
    done();
  });

  beforeEach(async done => {
    for (const shardId in db.shards) {
      await TestModel.destroyAll(shardId);
    }
    done();
  });

  it('has a proper collection', () => {
    let model1 = new TestModel('s1', { field1: 'value1', field2: 'value2' });
    expect(model1.__collection__).toEqual('test_model');
  });

  it('saves to proper shard', async () => {
    let model1 = new TestModel('s1', { field1: 'value1', field2: 'value2' });
    await model1.save();
    let model2 = await TestModel.findOne('s1', { _id: model1._id });
    expect(model2).toBeTruthy();
    if (model2) {
      expect(model2._id).toEqual(model1._id);
      expect(model2.shardId).toEqual('s1');
    }

    model2 = await TestModel.findOne('s2', { _id: model1._id });
    expect(model2).toEqual(null);
  });

  it('rejected fields should not be updated', async () => {
    let model: TestModel | null = new TestModel('s2', {
      field1: 'original_value',
      field2: 'mymodel_reject_test',
    });
    await model.save();

    const id = model._id;
    await model.update({ field1: 'mymodel_updated' });
    model = await TestModel.findOne('s2', { _id: id });
    expect(model).toBeTruthy();
    if (model !== null) {
      expect(model.field1).toEqual('original_value');
    }
  });

  it('other fields should be updated with update()', async () => {
    let model: TestModel | null = new TestModel('s3', {
      field1: 'original_value',
      field2: 'mymodel_update_test',
    });
    await model.save();

    const id = model._id;
    await model.update({ field2: 'mymodel_updated' });
    expect(model.field2).toEqual('mymodel_updated');

    model = await TestModel.findOne('s3', { _id: id });
    expect(model).toBeTruthy();
    if (model !== null) {
      expect(model.field2).toEqual('mymodel_updated');
    }
  });

  it('updateMany updates according to query', async () => {
    let model1: TestModel | null = new TestModel('s4', {
      field1: 'original_value',
      field2: 'mymodel_update_test',
    });
    await model1.save();
    let model2: TestModel | null = new TestModel('s4', {
      field1: 'original_value',
      field2: 'mymodel_update_test',
    });
    await model2.save();
    let model3: TestModel | null = new TestModel('s4', {
      field1: 'do_not_modify',
      field2: 'mymodel_update_test',
    });
    await model3.save();

    await TestModel.updateMany(
      's4',
      { field1: 'original_value' },
      { $set: { field2: 'mymodel_updated' } }
    );
    await Promise.all([model1.reload(), model2.reload(), model3.reload()]);
    expect(model1.field2).toEqual('mymodel_updated');
    expect(model2.field2).toEqual('mymodel_updated');
    expect(model3.field2).toEqual('mymodel_update_test');
  });

  it('reload() updates fields', async () => {
    let model1: TestModel | null = new TestModel('s1', {
      field1: 'original_value',
      field2: 'update_test',
    });
    await model1.save();
    let model2 = await TestModel.get('s1', model1._id);
    if (model2 === null) {
      fail('model is null');
    }
    await model2.update({ field2: 'updated' });
    expect(model2.field2).toEqual('updated');
    await model1.reload();
    expect(model1.field2).toEqual('updated');
  });

  it('find() returns a proper cursor', async () => {
    let model1: TestModel | null = new TestModel('s1', {
      field1: 'original_value',
      field2: 'mymodel_update_test',
    });
    await model1.save();

    let model2: TestModel | null = new TestModel('s1', {
      field1: 'original_value',
      field2: 'mymodel_update_test',
    });

    await model2.save();
    let model3: TestModel | null = new TestModel('s1', {
      field1: 'do_not_modify',
      field2: 'mymodel_update_test',
    });

    await model3.save();

    let cursor = TestModel.find('s1');
    expect(cursor).toBeInstanceOf(Cursor);
    expect(await cursor.count()).toEqual(3);

    let count = 0;
    for await (const item of cursor) {
      expect(item).toBeInstanceOf(TestModel);
      count++;
    }
    expect(count).toEqual(3);

    cursor = TestModel.find('s1').skip(2);
    expect(await cursor.count()).toEqual(3);

    count = 0;
    for await (const item of cursor) {
      expect(item).toBeInstanceOf(TestModel);
      count++;
    }
    expect(count).toEqual(1);

    cursor = TestModel.find('s1');
    expect(await cursor.next()).toBeInstanceOf(TestModel);

    await cursor.forEach(item => {
      expect(item).toBeInstanceOf(TestModel);
    });
  });
});
