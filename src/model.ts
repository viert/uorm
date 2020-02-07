import { ObjectID, Cursor } from 'mongodb';
import { Shard, db } from './db';
import { ObjectIdField, FieldType, StringField } from './fields';
import { snakeCase, CommonObject, Nullable } from './util';
import { validateField } from './validator';
import {
  WrongModelType,
  ModelDestroyed,
  SubmodelError,
  MissingSubmodel,
  WrongSubmodel,
} from './errors';

type FieldTypesDescriptor = { [key: string]: FieldType };
type DefaultsDescriptor = CommonObject;
type IndexDescriptor = {
  index: string | Array<any> | CommonObject;
  options?: CommonObject;
};

export class BaseModel {
  @ObjectIdField() _id: ObjectID | null = null;
  protected static __collection__: string | null = null;
  protected static __fields__: string[] = [];
  protected static __field_types__: FieldTypesDescriptor = {};
  protected static __defaults__: DefaultsDescriptor = {};
  protected static __required_fields__: string[] = [];
  protected static __rejected_fields__: string[] = [];
  protected static __restricted_fields__: string[] = [];
  protected static __auto_trim_fields__: string[] = [];
  protected static __async_computed__: string[] = [];
  protected static __submodel_loaders__: { [key: string]: Function } = {};
  static __key_field__ = '_id';
  static __indexes__: IndexDescriptor[] = [];
  static __submodel__: Nullable<string> = null;
  static readonly isSubmodel: boolean = false;
  static readonly isSharded: boolean = false;

  readonly __collection__: string;
  readonly __fields__: string[];
  readonly __field_types__: FieldTypesDescriptor;
  readonly __defaults__: DefaultsDescriptor;
  readonly __required_fields__: string[];
  readonly __rejected_fields__: string[];
  readonly __restricted_fields__: string[];
  readonly __auto_trim_fields__: string[];
  readonly __async_computed__: string[];
  readonly __submodel__: Nullable<string>;
  readonly isSubmodel: boolean;
  readonly isSharded: boolean;

  protected static getModelCollectionName(): string {
    const ctor = this as typeof BaseModel;
    if (ctor.__collection__ === null) {
      ctor.__collection__ = snakeCase(ctor.name);
    }
    return ctor.__collection__;
  }

  constructor(public shardId: Nullable<string> = null) {
    let e = new Error();
    if (e.stack && !e.stack.includes('make')) {
      throw new Error("Don't instantiate models with new(), use Model.make()");
    }

    const ctor = this.constructor as typeof BaseModel;
    // init collection properties (static + instance)
    this.__collection__ = ctor.getModelCollectionName();
    // hack to make static properties visible from instance code
    this.__fields__ = ctor.__fields__;
    this.__field_types__ = ctor.__field_types__;
    this.__defaults__ = ctor.__defaults__;
    this.__rejected_fields__ = ctor.__rejected_fields__;
    this.__required_fields__ = ctor.__required_fields__;
    this.__restricted_fields__ = ctor.__restricted_fields__;
    this.__auto_trim_fields__ = ctor.__auto_trim_fields__;
    this.__async_computed__ = ctor.__async_computed__;
    this.__submodel__ = ctor.__submodel__;
    this.isSubmodel = ctor.isSubmodel;
    this.isSharded = ctor.isSharded;
  }

  protected __getField(key: string): any {
    const asyncComputed = this.__async_computed__;
    let value = Reflect.get(this, key);
    if (typeof value === 'function' && !asyncComputed.includes(key)) {
      return undefined;
    }
    return value;
  }

  protected __setField(key: string, value: any): void {
    Reflect.set(this, key, value);
  }

  db(): Shard {
    if (this.shardId === null) {
      return db.meta();
    } else {
      return db.getShard(this.shardId);
    }
  }

  _fill(data: CommonObject) {
    for (const field of this.__fields__) {
      let calculatedValue: any = null;
      if (field in data) {
        // explicit assignment
        calculatedValue = data[field];
      }
      if (calculatedValue === null && field in this.__defaults__) {
        // default values if no explicit value
        let defaultValue = this.__defaults__[field];
        if (defaultValue instanceof Array) {
          calculatedValue = [...defaultValue];
        } else if (defaultValue instanceof Function) {
          calculatedValue = defaultValue();
        } else {
          calculatedValue = defaultValue;
        }
      }
      this.__setField(field, calculatedValue);
    }
  }

  static make<T extends typeof BaseModel>(
    this: T,
    data: CommonObject = {}
  ): InstanceType<T> {
    if (this.isSubmodel) {
      // Submodel cases
      if (!data._id) {
        // creating new submodel object
        if (!this.__submodel__) {
          throw new SubmodelError(
            `Attempted to create an object of abstract submodel ${this.name}`
          );
        }
        if ('submodel' in data) {
          throw new SubmodelError(
            'Attempt to override submodel for a new object'
          );
        }
        data.submodel = this.__submodel__;
      } else {
        // loading submodel object from database
        const submodelName = data.submodel;
        if (!submodelName) {
          throw new MissingSubmodel(`${this.name} has no submodel in DB. Bug?`);
        }

        if (!this.__submodel__) {
          // abstract submodel, search in loaders
          if (!(submodelName in this.__submodel_loaders__)) {
            throw new WrongSubmodel(
              `Model ${submodelName} is not registered in ${this.name}`
            );
          } else {
            const properCtor = this.__submodel_loaders__[submodelName] as T;
            return properCtor.make(data);
          }
        }
      }
    }
    const shardId = this.isSharded ? data.shard_id : null;
    const r = new this(shardId); // data.shard_id may not be null for non-sharded models
    r._fill(data);
    r._checkSubmodel();
    return r as InstanceType<T>;
  }

  isNew() {
    return this._id === null;
  }

  toObject(
    fields: string[] | null = null,
    includeRestricted: boolean = false
  ): { [key: string]: any } {
    if (fields === null) {
      fields = this.__fields__;
    }

    let obj: { [key: string]: any } = {};
    for (const field of fields) {
      if (includeRestricted || !this.__restricted_fields__.includes(field)) {
        const value = this.__getField(field);
        const valueType = typeof value;
        if (valueType !== 'undefined' && valueType !== 'function') {
          obj[field] = value;
        }
      }
    }
    return obj;
  }

  async asyncObject(
    fields: string[] | null = null,
    includeRestricted: boolean = false
  ): Promise<{ [key: string]: any }> {
    const restricted = this.__restricted_fields__;
    const modelFields = this.__fields__;
    const asyncComputedFields = this.__async_computed__;

    if (fields === null) {
      fields = modelFields;
    }

    let obj: { [key: string]: any } = {};
    let afields: string[] = [];
    let agetters: Promise<any>[] = [];

    for (const field of fields) {
      if (asyncComputedFields.includes(field)) {
        const getter = this.__getField(field).bind(this);
        // Run async getter, fetch later with await Promise.all
        afields.push(field);
        agetters.push(getter());
      } else if (includeRestricted || !restricted.includes(field)) {
        let value = this.__getField(field);
        if (value instanceof Cursor) {
          afields.push(field);
          agetters.push(value.toArray());
        } else if (typeof value !== 'undefined') {
          obj[field] = value;
        }
      }
    }

    // load async values
    if (agetters.length) {
      const values = await Promise.all(agetters);
      for (let i = 0; i < afields.length; i++) {
        obj[afields[i]] = values[i];
      }
    }

    return obj;
  }

  isValid() {
    try {
      this._validateAndTrim();
    } catch (_) {
      return false;
    }
    return true;
  }

  protected _validateAndTrim() {
    this.__fields__.forEach(field => {
      if (field === '_id') return;
      const value = this.__getField(field);
      const fieldType = this.__field_types__[field];
      const isRequired = this.__required_fields__.includes(field);
      const autoTrim = this.__auto_trim_fields__.includes(field);
      validateField(field, value, fieldType, isRequired, autoTrim);
      if (autoTrim && value && value.trim) this.__setField(field, value.trim());
    });
    this._checkSubmodel();
  }

  _checkSubmodel() {
    if (!this.isSubmodel) return;
    const submodelField = (this as any).submodel as Nullable<string>;
    if (submodelField !== this.__submodel__) {
      throw new WrongSubmodel(
        `Attempted to load ${submodelField} as ${this.constructor.name}. Correct submodel would be ${this.__submodel__}. Bug?`
      );
    }
  }

  async save(skipCallback: boolean = false): Promise<void> {
    const isNew = this.isNew();

    if (!skipCallback) {
      await this._before_validation();
    }
    this._validateAndTrim();

    if (!skipCallback) {
      await this._before_save();
    }
    await this._save_to_db();
    if (!skipCallback) {
      await this._after_save(isNew);
    }
  }

  async update(
    data: CommonObject,
    skipCallback: boolean = false
  ): Promise<void> {
    for (const field of this.__fields__) {
      if (
        field in data &&
        !this.__rejected_fields__.includes(field) &&
        field !== '_id'
      ) {
        this.__setField(field, data[field]);
      }
    }
    await this.save(skipCallback);
  }

  async destroy(skipCallback: boolean = false): Promise<void> {
    if (this.isNew()) {
      return;
    }

    if (!skipCallback) {
      await this._before_delete();
    }
    await this._delete_from_db();

    if (!skipCallback) {
      await this._after_delete();
    }
    this._id = null;
  }

  static _preprocessQuery(query: CommonObject) {
    return query;
  }

  static registerSubmodel<T extends typeof BaseModel>(name: string, ctor: T) {
    if (!this.isSubmodel) {
      throw new WrongModelType(
        'Attempted to register a submodel with a non-submodel class'
      );
    }

    if (this.__submodel__) {
      throw new SubmodelError(
        'Attempted to register a submodel with another submodel'
      );
    }
    if (name in this.__submodel_loaders__) {
      throw new SubmodelError(`Submodel ${name} is already registered`);
    }
    this.__submodel_loaders__[name] = ctor;
  }

  protected async _before_save() {}
  protected async _before_validation() {}
  protected async _before_delete() {}
  protected async _after_save(_isNew: boolean = true) {}
  protected async _after_delete() {}
  protected async _save_to_db(): Promise<any> {}
  protected async _delete_from_db(): Promise<any> {}
  async invalidate() {}

  protected static _getPossibleShards(): Shard[] {
    return [];
  }

  static async ensureIndexes() {
    const shards = this._getPossibleShards();
    for (const idesc of this.__indexes__) {
      for (const shard of shards) {
        const coll = shard.db().collection(this.getModelCollectionName());
        const { index, options = {} } = idesc;
        await coll.createIndex(index, options);
      }
    }
  }
}

export class StorableModel extends BaseModel {
  protected static getShard(shardId?: Nullable<string>): Shard {
    if (shardId) {
      throw new WrongModelType(
        `${this.name} model doesn't support shards, however shardId is defined`
      );
    }
    return db.meta();
  }

  static async findOne<T extends typeof StorableModel>(
    this: T,
    query: CommonObject,
    shardId?: Nullable<string>
  ) {
    const database = this.getShard(shardId);
    return await database.getObject(
      this.getModelCollectionName(),
      this._preprocessQuery(query),
      this
    );
  }

  static async get<T extends typeof StorableModel>(
    this: T,
    expression: any,
    raise: string | Error | null = null,
    shardId?: Nullable<string>
  ): Promise<Nullable<InstanceType<T>>> {
    if (expression === null) return Promise.resolve(null);
    let query: CommonObject;
    if (expression instanceof ObjectID) {
      query = { _id: expression };
    } else {
      try {
        let idExpr = new ObjectID(expression);
        query = { _id: idExpr };
      } catch (e) {
        let keyField = `${this.__key_field__}`;
        query = { [keyField]: expression };
      }
    }
    let result = await this.findOne(this._preprocessQuery(query), shardId);
    if (result === null && raise !== null) {
      if (raise instanceof Error) {
        throw raise;
      }
      throw new Error(raise);
    }
    return result;
  }

  static find<T extends typeof StorableModel>(
    this: T,
    query: CommonObject = {},
    shardId?: Nullable<string>
  ) {
    const database = this.getShard(shardId);
    return database.getObjectsCursor(
      this.getModelCollectionName(),
      this._preprocessQuery(query),
      this
    );
  }

  async reload<T extends typeof StorableModel>() {
    if (this.isNew()) return;
    let ctor = this.constructor as T;
    let tmp = await ctor.findOne({ _id: this._id }, this.shardId);
    if (!tmp) {
      throw new ModelDestroyed();
    }
    this._fill(tmp.toObject(null, true));
  }

  static async updateMany<T extends typeof StorableModel>(
    this: T,
    query: CommonObject,
    update: CommonObject,
    shardId?: Nullable<string>
  ) {
    const database = this.getShard(shardId);
    return await database.updateQuery(
      this.getModelCollectionName(),
      this._preprocessQuery(query),
      update
    );
  }

  static async destroyMany<T extends typeof StorableModel>(
    this: T,
    query: CommonObject,
    shardId?: Nullable<string>
  ) {
    const database = this.getShard(shardId);
    return await database.deleteQuery(
      this.getModelCollectionName(),
      this._preprocessQuery(query)
    );
  }

  static async destroyAll(shardId?: Nullable<string>) {
    return await this.destroyMany({}, shardId);
  }

  async dbUpdate(
    update: CommonObject,
    when: Nullable<CommonObject> = null,
    reload: boolean = true,
    invalidateCache: boolean = true
  ) {
    const newData = await this.db().findAndUpdateObject(this, update, when);
    if (newData) {
      if (invalidateCache) {
        await this.invalidate();
      }
      if (reload) {
        this._fill(newData);
      }
    }
  }

  protected async _save_to_db() {
    await this.db().saveObj(this);
  }

  protected async _delete_from_db() {
    await this.db().deleteObj(this);
  }

  protected static _getPossibleShards(): Shard[] {
    return [db.meta()];
  }
}

export class ShardedModel extends StorableModel {
  static isSharded = true;
  protected static getShard(shardId?: Nullable<string>): Shard {
    if (!shardId) {
      throw new WrongModelType(
        `${this.name} model uses shards, however shardId is not provided`
      );
    }
    return db.getShard(shardId);
  }
  protected static _getPossibleShards(): Shard[] {
    return Object.values(db.shards());
  }
}

export class StorableSubmodel extends StorableModel {
  @StringField({ required: true }) submodel: string;
  static readonly isSubmodel = true;
  static _preprocessQuery(query: CommonObject) {
    if (!this.__submodel__) return query;
    return {
      ...query,
      submodel: this.__submodel__,
    };
  }
}

export class ShardedSubmodel extends ShardedModel {
  @StringField({ required: true }) submodel: string;
  static readonly isSubmodel = true;
  static _preprocessQuery(query: CommonObject) {
    if (!this.__submodel__) return query;
    return {
      ...query,
      submodel: this.__submodel__,
    };
  }
}
