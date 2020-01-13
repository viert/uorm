import { StorableModel, Field, db } from '../src';

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

const randomDatabase =
  Math.random()
    .toString(36)
    .substring(2, 15) +
  Math.random()
    .toString(36)
    .substring(2, 15);

describe('storable model', () => {
  beforeAll(async done => {
    await db.init({
      meta: {
        uri: 'mongodb://localhost',
        dbname: randomDatabase,
        options: { useUnifiedTopology: true },
      },
      shards: {},
    });
    done();
  });

  afterAll(async done => {
    await db.meta.db.dropDatabase();
    done();
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
});
