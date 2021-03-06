import {
  ShardedModel,
  StringField,
  NumberField,
  db,
  ModelCursor,
} from '../src';
import { initDatabases } from './util';
import { ShardIsReadOnly } from '../src/errors';

const DEFAULT_CALLABLE_VALUE: number = 4;

function callable(): number {
  return DEFAULT_CALLABLE_VALUE;
}

class TestModel extends ShardedModel {
  @StringField({ defaultValue: 'default_value', rejected: true })
  field1: string;
  @StringField({ required: true }) field2: string;
  @StringField({ defaultValue: 'required_default_value', required: true })
  field3: string;
  @NumberField({ defaultValue: callable }) callable_default_field: number;
}

describe('sharded model', () => {
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

  beforeEach(async done => {
    for (const shardId in db.shards()) {
      if (db.getShard(shardId).isOpen()) await TestModel.destroyAll(shardId);
    }
    done();
  });

  it('has a proper collection', () => {
    let model1 = TestModel.make({
      shard_id: 's1',
      field1: 'value1',
      field2: 'value2',
    });
    expect(model1.__collection__).toEqual('test_model');
  });

  it('saves to proper shard', async () => {
    let model1 = TestModel.make({
      shard_id: 's1',
      field1: 'value1',
      field2: 'value2',
    });
    await model1.save();
    let model2 = await TestModel.findOne({ _id: model1._id }, 's1');
    expect(model2).toBeTruthy();
    if (model2) {
      expect(model2._id).toEqual(model1._id);
      expect(model2.shardId).toEqual('s1');
    }

    model2 = await TestModel.findOne({ _id: model1._id }, 's2');
    expect(model2).toEqual(null);
  });

  it('rejected fields should not be updated', async () => {
    let model: TestModel | null = TestModel.make({
      shard_id: 's2',
      field1: 'original_value',
      field2: 'mymodel_reject_test',
    });
    await model.save();

    const id = model._id;
    await model.update({ field1: 'mymodel_updated' });
    model = await TestModel.findOne({ _id: id }, 's2');
    expect(model).toBeTruthy();
    if (model !== null) {
      expect(model.field1).toEqual('original_value');
    }
  });

  it('other fields should be updated with update()', async () => {
    let model: TestModel | null = TestModel.make({
      shard_id: 's3',
      field1: 'original_value',
      field2: 'mymodel_update_test',
    });
    await model.save();

    const id = model._id;
    await model.update({ field2: 'mymodel_updated' });
    expect(model.field2).toEqual('mymodel_updated');

    model = await TestModel.findOne({ _id: id }, 's3');
    expect(model).toBeTruthy();
    if (model !== null) {
      expect(model.field2).toEqual('mymodel_updated');
    }
  });

  it('updateMany updates according to query', async () => {
    let model1: TestModel | null = TestModel.make({
      shard_id: 's4',
      field1: 'original_value',
      field2: 'mymodel_update_test',
    });
    await model1.save();
    let model2: TestModel | null = TestModel.make({
      shard_id: 's4',
      field1: 'original_value',
      field2: 'mymodel_update_test',
    });
    await model2.save();
    let model3: TestModel | null = TestModel.make({
      shard_id: 's4',
      field1: 'do_not_modify',
      field2: 'mymodel_update_test',
    });
    await model3.save();

    await TestModel.updateMany(
      { field1: 'original_value' },
      { $set: { field2: 'mymodel_updated' } },
      's4'
    );
    await Promise.all([model1.reload(), model2.reload(), model3.reload()]);
    expect(model1.field2).toEqual('mymodel_updated');
    expect(model2.field2).toEqual('mymodel_updated');
    expect(model3.field2).toEqual('mymodel_update_test');
  });

  it('reload() updates fields', async () => {
    let model1: TestModel | null = TestModel.make({
      shard_id: 's1',
      field1: 'original_value',
      field2: 'update_test',
    });
    await model1.save();
    let model2 = await TestModel.get(model1._id, null, 's1');
    if (model2 === null) {
      fail('model is null');
    }
    await model2.update({ field2: 'updated' });
    expect(model2.field2).toEqual('updated');
    await model1.reload();
    expect(model1.field2).toEqual('updated');
  });

  it('find() returns a proper cursor', async () => {
    let model1: TestModel | null = TestModel.make({
      shard_id: 's1',
      field1: 'original_value',
      field2: 'mymodel_update_test',
    });
    await model1.save();
    let model2: TestModel | null = TestModel.make({
      shard_id: 's1',
      field1: 'original_value',
      field2: 'mymodel_update_test',
    });
    await model2.save();
    let model3: TestModel | null = TestModel.make({
      shard_id: 's1',
      field1: 'do_not_modify',
      field2: 'mymodel_update_test',
    });
    await model3.save();

    let cursor = TestModel.find({}, 's1');
    expect(cursor).toBeInstanceOf(ModelCursor);
    expect(await cursor.count()).toEqual(3);

    let count = 0;
    for await (const item of cursor) {
      expect(item).toBeInstanceOf(TestModel);
      count++;
    }
    expect(count).toEqual(3);

    cursor = TestModel.find({}, 's1').skip(2);
    expect(await cursor.count()).toEqual(3);
    count = 0;
    for await (const item of cursor) {
      expect(item).toBeInstanceOf(TestModel);
      count++;
    }
    expect(count).toEqual(1);

    cursor = TestModel.find({}, 's1');
    expect(await cursor.next()).toBeInstanceOf(TestModel);

    await cursor.forEach(item => {
      expect(item).toBeInstanceOf(TestModel);
    });
  });

  it('fails to write to closed shard', async () => {
    let model1: TestModel | null = TestModel.make({
      shard_id: 'ro',
      field1: 'original_value',
      field2: 'mymodel_update_test',
    });
    expect(model1.save()).rejects.toThrow(ShardIsReadOnly);
  });

  it('fails if shard_id field is defined', async () => {
    expect(() => {
      class FailedModel extends ShardedModel {
        @StringField() shard_id: string;
      }
      FailedModel.make({ shard_id: 's1' });
    }).toThrowError(/shard_id/);
  });
});
