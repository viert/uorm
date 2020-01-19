import {
  AbstractModel,
  Field,
  SaveRequired,
  InvalidFieldType,
  AsyncComputed,
} from '../src';
import { ObjectID } from 'bson';

function callable(): number {
  return 4;
}

class TestModel extends AbstractModel {
  static __key_field__ = 'field1';
  @Field({ required: true }) field1: string;
  @Field({ defaultValue: 'default_value', restricted: true }) field2: string;
  @Field({ defaultValue: callable }) field3: number;

  getFields(): string[] {
    return this.__fields__;
  }
  async _delete_from_db() {}
  async _save_to_db() {}

  @SaveRequired
  getField1() {
    return this.field1;
  }

  @AsyncComputed()
  async concatAll() {
    return this.field1 + this.field2 + this.field3;
  }
}

describe('abstract model', () => {
  it('constructor assigns values', () => {
    let model = new TestModel({
      field1: 'value1',
    });
    expect(model.getFields()).toContain('_id');
    expect(model.getFields()).toContain('field1');
    expect(model._id).toEqual(null);
    expect(model.field1).toEqual('value1');
    expect(model.field2).toEqual('default_value');
  });

  it('incomplete model fails to validate', () => {
    let model = new TestModel({});
    expect(model.isValid).toBeFalsy();
  });

  it('callable defaults produce values', () => {
    let model = new TestModel({
      field1: 'value1',
    });
    expect(model.field3).toEqual(4);
  });

  it('type validation works', () => {
    let model = new TestModel({
      field1: 'value1',
    });
    expect(model.isValid).toBeTruthy();

    model = new TestModel({
      field1: 135,
    });
    expect(model.isValid).toBeFalsy();
  });

  it('autotrim fields are autotrimmed', async () => {
    let model = new TestModel({
      field1: ' \t  trimmed   \n',
    });
    await model.save();
    expect(model.field1).toEqual('trimmed');
  });

  it('properties are visible in toObject', () => {
    let model = new TestModel({
      field1: 'value',
    });
    let obj = model.toObject(['field1', 'isNew', 'isValid']);
    expect(obj.field1).toEqual('value');
    expect(obj.isNew).toEqual(true);
    expect(obj.isValid).toEqual(true);
  });

  it('restricted fields are wiped out', () => {
    let model = new TestModel({
      field1: 'value',
      field2: 'value2',
    });
    expect(model.field2).toEqual('value2');
    let obj = model.toObject(['field2']);
    expect(Object.keys(obj).length).toEqual(0);
  });

  it('method with SaveRequired fails before saving', () => {
    let model = new TestModel({
      field1: 'value',
    });
    expect(model.getField1).toThrowError();
    model._id = new ObjectID();
    expect(model.getField1()).toEqual('value');
  });

  it('save fails if validation fails', async () => {
    let model = new TestModel({
      field1: 135,
    });
    let actualError: any = null;
    try {
      await model.save();
    } catch (e) {
      actualError = e;
    }
    expect(actualError).toBeInstanceOf(InvalidFieldType);
  });

  it('async computed properties calculate properly', async () => {
    let model = new TestModel({
      field1: 'value1',
      field2: 'value2',
      field3: 'value3',
    });
    let obj = await model.asyncObject([
      'field1',
      'field2',
      'field3',
      'concatAll',
    ]);
    expect(obj['field1']).toEqual('value1');
    expect(obj['field2']).toBeUndefined(); // restricted
    expect(obj['field3']).toEqual('value3');
    expect(obj['concatAll']).toEqual('value1value2value3'); // computed;
    obj = await model.asyncObject(['field2', 'concatAll'], true);
    expect(obj['concatAll']).toEqual('value1value2value3'); // computed;
    expect(obj['field2']).toEqual('value2'); // restricted but allowed
  });
});
