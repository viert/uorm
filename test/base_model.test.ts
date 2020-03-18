import { BaseModel } from '../src/model';
import {
  StringField,
  BooleanField,
  FieldType,
  NumberField,
  AsyncComputed,
} from '../src/fields';
import { SaveRequired } from '../src/util';
import { ObjectID } from 'mongodb';
import { ValidationError, ModelSaveRequired } from '../src/errors';

const CALLABLE_VALUE = 483;

function callable() {
  return CALLABLE_VALUE;
}

class User extends BaseModel {
  @StringField({ required: true }) username: string;
  @StringField({ defaultValue: 'IT' }) department: string;
  @BooleanField({ restricted: true, rejected: true, defaultValue: false })
  supervisor: boolean;
  @StringField({ autoTrim: true }) trimmed: string;
  @NumberField({ defaultValue: () => 42 }) default_response: number;
}

describe('BaseModel tests', () => {
  it('constructs with defaults', () => {
    const u = User.make({ username: 'paul' });
    expect(u.username).toEqual('paul');
    expect(u.department).toEqual('IT');
    expect(u.isNew()).toEqual(true);
  });

  it('has proper collection name', () => {
    class MyModel extends BaseModel {
      static _cname() {
        return this.getModelCollectionName();
      }
    }
    class MyUserModel extends BaseModel {
      static __collection__ = 'users';
      static _cname() {
        return this.getModelCollectionName();
      }
    }
    const mm = MyModel.make({});
    expect(mm.__collection__).toEqual('my_model');
    const user = MyUserModel.make({});
    expect(user.__collection__).toEqual('users');
    expect(MyModel._cname()).toEqual('my_model');
    expect(MyUserModel._cname()).toEqual('users');
  });

  it('has magic properties set', () => {
    const u = User.make({ username: 'paul' });
    expect(u.__auto_trim_fields__).toContain('trimmed');
    expect(u.__restricted_fields__).toContain('supervisor');
    expect(u.__rejected_fields__).toContain('supervisor');
    expect(u.__field_types__['username']).toEqual(FieldType.string);
    expect(u.__field_types__['supervisor']).toEqual(FieldType.boolean);
  });

  it('incomplete models fail to validate', async () => {
    const u = User.make({});
    expect(u.save()).rejects.toThrow(/Field "username" can not be empty/);
  });

  it('callable defaults produce values', () => {
    class CallableModel extends BaseModel {
      @StringField({ defaultValue: () => 'value' }) field: string;
      @NumberField({
        defaultValue: () => {
          return 134;
        },
      })
      field2: number;
      @NumberField({ defaultValue: callable }) field3: number;
    }
    const model = CallableModel.make();
    expect(model.field).toEqual('value');
    expect(model.field2).toEqual(134);
    expect(model.field3).toEqual(CALLABLE_VALUE);
  });

  it('defaults cover explicitly nulled values', () => {
    let model = User.make({
      username: 'paul',
      department: null,
      default_response: null,
    });
    expect(model.department).toEqual('IT');
    expect(model.default_response).toEqual(42);
  });

  it('type validation works', () => {
    let model = User.make({
      username: 'paul',
    });
    expect(model.isValid()).toBeTruthy();

    model = User.make({
      username: 135,
    });
    expect(model.isValid()).toBeFalsy();
  });

  it('autotrim fields are autotrimmed', async () => {
    let model = User.make({
      username: 'paul',
      trimmed: ' \t  trimmed   \n',
    });
    await model.save();
    expect(model.trimmed).toEqual('trimmed');
  });

  it('properties are visible in toObject', () => {
    class ComputedModel extends BaseModel {
      @StringField() first_name: string;
      @StringField() last_name: string;

      get full_name() {
        return this.first_name + ' ' + this.last_name;
      }
    }
    let model = ComputedModel.make({
      first_name: 'Paul',
      last_name: 'Smith',
    });
    let obj = model.toObject(['first_name', 'full_name', 'last_name']);
    expect(obj.first_name).toEqual('Paul');
    expect(obj.last_name).toEqual('Smith');
    expect(obj.full_name).toEqual('Paul Smith');
  });

  it('restricted fields are wiped out', () => {
    let model = User.make({
      username: 'paul',
      supervisor: true,
    });
    let obj = model.toObject(['username', 'supervisor']);
    expect(obj.username).toEqual('paul');
    expect(obj.supervisor).toBeUndefined();
  });

  it('method with SaveRequired fails before saving', () => {
    class ComplexModel extends BaseModel {
      @StringField() field1: string;

      @SaveRequired
      getField1() {
        return this.field1;
      }
    }
    let model = ComplexModel.make({ field1: 'value1' });
    expect(model.getField1.bind(model)).toThrow(ModelSaveRequired);
    model._id = new ObjectID();
    expect(model.getField1()).toEqual('value1');
  });

  it('save fails when validation fails', async () => {
    let model = User.make({ username: 'paul', department: 15 });
    // toThrow with a proper Error constructor works only in es6+
    expect(model.save()).rejects.toThrow(ValidationError);
  });

  it('async computed properties calculate properly', async () => {
    class AsyncModel extends BaseModel {
      @StringField() first_name: string;
      @StringField() last_name: string;

      @AsyncComputed()
      async full_name() {
        return await Promise.resolve(`${this.first_name} ${this.last_name}`);
      }
    }

    const model = AsyncModel.make({
      first_name: 'Paul',
      last_name: 'Smith',
    });
    const obj = await model.asyncObject([
      'first_name',
      'last_name',
      'full_name',
    ]);
    expect(obj.first_name).toEqual('Paul');
    expect(obj.last_name).toEqual('Smith');
    expect(obj.full_name).toEqual('Paul Smith');
  });

  it('async computed properties convert BaseModels to Objects', async () => {
    class AsyncReferenced extends BaseModel {
      @StringField({ required: true }) name: string;
    }
    const ref = AsyncReferenced.make({ name: 'referenced' });

    class AsyncModel extends BaseModel {
      @AsyncComputed()
      async reference() {
        return Promise.resolve(ref);
      }
    }

    const model = AsyncModel.make({});

    const obj = await model.asyncObject(['reference']);
    expect(obj.reference instanceof BaseModel).toBeFalsy();
    expect(obj.reference).toHaveProperty('name');
    expect(obj.reference.name).toEqual('referenced');
    expect(obj.reference.__collection__).toBeUndefined();
  });
});
