import { StorableModel, Field, db } from '../src';
import { Cursor } from 'mongodb';
import { initDatabases } from './util';

const DEFAULT_CALLABLE_VALUE: number = 4;

function callable(): number {
  return DEFAULT_CALLABLE_VALUE;
}

class TestModel extends StorableModel {
  @Field({ defaultValue: 'default_value', rejected: true }) field1: string;
  @Field({ required: true }) field2: string;
  @Field({ defaultValue: 'required_default_value', required: true })
  field3: string;
  @Field({ defaultValue: callable }) callable_default_field: number;
}

describe('storable model', () => {
  beforeAll(async done => {
    await initDatabases();
    done();
  });

  beforeEach(async done => {
    await TestModel.destroyAll();
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

  it('has a proper collection name', () => {
    const model = new TestModel({ field2: 'mymodel' });
    expect(model.__collection__()).toEqual('test_model');
  });

  it('once saved let be acquired', async () => {
    const model = new TestModel({ field2: 'mymodel' });
    await model.save();
    const model2 = await TestModel.findOne({ field2: 'mymodel' });
    expect(model2).toBeTruthy();
    if (model2 !== null) {
      expect(model._id).toEqual(model2._id);
    }
  });

  it('update() should not affect not updated fields', async () => {
    let model = new TestModel({
      field1: 'orig1',
      field2: 'orig2',
      field3: 'orig3',
      callable_default_field: 14,
    });
    await model.save();
    await model.update({ field2: 'updated2' });
    await model.reload();
    expect(model.field1).toEqual('orig1');
    expect(model.field2).toEqual('updated2');
    expect(model.field3).toEqual('orig3');
    expect(model.callable_default_field).toEqual(14);
  });

  it('rejected fields should not be updated', async () => {
    let model: TestModel | null = new TestModel({
      field1: 'original_value',
      field2: 'mymodel_reject_test',
    });
    await model.save();

    const id = model._id;
    await model.update({ field1: 'mymodel_updated' });
    model = await TestModel.findOne({ _id: id });
    expect(model).toBeTruthy();
    if (model !== null) {
      expect(model.field1).toEqual('original_value');
    }
  });

  it('other fields should be updated with update()', async () => {
    let model: TestModel | null = new TestModel({
      field1: 'original_value',
      field2: 'mymodel_update_test',
    });
    await model.save();

    const id = model._id;
    await model.update({ field2: 'mymodel_updated' });
    expect(model.field2).toEqual('mymodel_updated');

    model = await TestModel.findOne({ _id: id });
    expect(model).toBeTruthy();
    if (model !== null) {
      expect(model.field2).toEqual('mymodel_updated');
    }
  });

  it('dbUpdate updates fields', async () => {
    let model = new TestModel({
      field1: 'orig1',
      field2: 'orig2',
      field3: 'orig3',
      callable_default_field: 14,
    });
    await model.save();
    await model.dbUpdate({ $set: { field3: 'updated3' } });
    expect(model.field1).toEqual('orig1');
    expect(model.field2).toEqual('orig2');
    expect(model.field3).toEqual('updated3');
    expect(model.callable_default_field).toEqual(14);

    await model.dbUpdate({ $set: { field2: 'updated2' } }, null, false);
    expect(model.field2).toEqual('orig2');
    await model.reload();
    expect(model.field2).toEqual('updated2');
  });

  it('updateMany updates according to query', async () => {
    let model1: TestModel | null = new TestModel({
      field1: 'original_value',
      field2: 'mymodel_update_test',
    });
    await model1.save();
    let model2: TestModel | null = new TestModel({
      field1: 'original_value',
      field2: 'mymodel_update_test',
    });
    await model2.save();
    let model3: TestModel | null = new TestModel({
      field1: 'do_not_modify',
      field2: 'mymodel_update_test',
    });
    await model3.save();

    await TestModel.updateMany(
      { field1: 'original_value' },
      { $set: { field2: 'mymodel_updated' } }
    );
    await Promise.all([model1.reload(), model2.reload(), model3.reload()]);
    expect(model1.field2).toEqual('mymodel_updated');
    expect(model2.field2).toEqual('mymodel_updated');
    expect(model3.field2).toEqual('mymodel_update_test');
  });

  it('reload() updates fields', async () => {
    let model1: TestModel | null = new TestModel({
      field1: 'original_value',
      field2: 'update_test',
    });
    await model1.save();
    let model2 = await TestModel.get(model1._id);
    if (model2 === null) {
      fail('model is null');
    }
    await model2.update({ field2: 'updated' });
    expect(model2.field2).toEqual('updated');
    await model1.reload();
    expect(model1.field2).toEqual('updated');
  });

  it('find() returns a proper cursor', async () => {
    let model1: TestModel | null = new TestModel({
      field1: 'original_value',
      field2: 'mymodel_update_test',
    });
    await model1.save();
    let model2: TestModel | null = new TestModel({
      field1: 'original_value',
      field2: 'mymodel_update_test',
    });
    await model2.save();
    let model3: TestModel | null = new TestModel({
      field1: 'do_not_modify',
      field2: 'mymodel_update_test',
    });
    await model3.save();

    let cursor = TestModel.find();
    expect(cursor).toBeInstanceOf(Cursor);
    expect(await cursor.count()).toEqual(3);

    let count = 0;
    for await (const item of cursor) {
      expect(item).toBeInstanceOf(TestModel);
      count++;
    }
    expect(count).toEqual(3);

    cursor = TestModel.find().skip(2);
    expect(await cursor.count()).toEqual(3);

    count = 0;
    for await (const item of cursor) {
      expect(item).toBeInstanceOf(TestModel);
      count++;
    }
    expect(count).toEqual(1);

    cursor = TestModel.find();
    expect(await cursor.next()).toBeInstanceOf(TestModel);

    await cursor.forEach(item => {
      expect(item).toBeInstanceOf(TestModel);
    });
  });
  it('fields explicitly set to null in ctor are affected by model defaults', async () => {
    class CModel extends StorableModel {
      @Field() f1: any;
      @Field() f2: any;
      @Field() f3: any;
      @Field() f4: any;
      static _collection = 'cmodel';
    }

    class DModel extends StorableModel {
      @Field({ defaultValue: 1 }) f1: number;
      @Field({ defaultValue: [] }) f2: string[];
      @Field({ defaultValue: '3' }) f3: string;
      @Field({ defaultValue: { hello: 'world' } }) f4: { [key: string]: any };
      static _collection = 'cmodel';
    }

    let model = new CModel({ f1: null, f2: null, f3: null, f4: null });
    await model.save();

    let model2 = await DModel.findOne({ _id: model._id });
    if (model2 === null) {
      fail();
    }
    expect(model2.f1).toEqual(1);
    expect(model2.f2).toEqual([]);
    expect(model2.f3).toEqual('3');
    expect(model2.f4).toHaveProperty('hello');
    expect(model2.f4.hello).toEqual('world');

    await model2.update({ f1: 5 });
    expect(model2.f1).toEqual(5);
  });
});
