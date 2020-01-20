import 'reflect-metadata';
import { ObjectID } from 'bson';
import { FieldRequired, ValidationError } from './errors';
import {
  FieldType,
  FIELDS_META_KEY,
  FIELD_TYPES_META_KEY,
  REJECTED_FIELDS_META_KEY,
  RESTRICTED_FIELDS_META_KEY,
  AUTO_TRIM_FIELDS_META_KEY,
  DEFAULT_VALUES_META_KEY,
  REQUIRED_FIELDS_META_KEY,
  ASYNC_COMPUTED_PROPERTIES_META_KEY,
  ObjectIdField,
} from './decorators';
import db, { DBShard } from './db';

function validateField(
  field: string,
  value: any,
  type: FieldType,
  required: boolean,
  autotrim: boolean
) {
  // null fields are ok
  if (value === null) {
    if (required) {
      console.log('throwing fieldrequired');
      throw new FieldRequired(`Field ${field} is required, got null`);
    }
    return;
  }

  switch (type) {
    case FieldType.any:
      return;
    case FieldType.array:
      if (value instanceof Array) return;
      throw new ValidationError(`Field ${field} must be an array`);
    case FieldType.number:
      if (value instanceof Number || typeof value === 'number') return;
      throw new ValidationError(`Field ${field} must be a number`);
    case FieldType.string:
      if (value instanceof String || typeof value === 'string') {
        if (autotrim) {
          value = value.trim();
        }
        if (required && !value) {
          throw new FieldRequired(`Field ${field} can not be empty`);
        }
        return;
      }
      throw new ValidationError(`Field ${field} must be a string`);
    case FieldType.datetime:
      if (value instanceof Date) return;
      throw new ValidationError(`Field ${field} must be a datetime`);
    case FieldType.objectid:
      if (value instanceof ObjectID) return;
      throw new ValidationError(`Field ${field} must be an ObjectID instance`);
    case FieldType.object:
      if (value instanceof Object) return;
      throw new ValidationError(`Field ${field} must be an object`);
    default:
      return;
  }
}

function snakeCase(name: string) {
  let result: string = '';
  for (let i = 0; i < name.length; i++) {
    const sym = name.charAt(i);
    const code = name.charCodeAt(i);
    if (65 <= code && code <= 90) {
      if (i) {
        result += '_';
      }
      result += sym.toLowerCase();
    } else {
      result += sym;
    }
  }
  return result;
}

export default abstract class AbstractModel {
  @ObjectIdField() _id: ObjectID | null;
  protected static _collection: string | null = null;

  static __collection__(): string {
    if (!this._collection) {
      this._collection = snakeCase(this.name);
    }
    return this._collection;
  }

  // a hack to make '__collection__' both static and instance property
  __collection__(): string {
    return (this.constructor as typeof AbstractModel).__collection__();
  }

  static db(): DBShard {
    return db.meta();
  }

  // a hack to make 'db' both static and instance property
  db(): DBShard {
    return (this.constructor as typeof AbstractModel).db();
  }

  protected static _preprocessQuery(query: {
    [key: string]: any;
  }): { [key: string]: any } {
    return query;
  }

  protected _preprocessQuery(query: {
    [key: string]: any;
  }): { [key: string]: any } {
    return (this.constructor as any)._preprocessQuery(query);
  }

  constructor(data: { [key: string]: any } = {}) {
    let fields = this.__fields__();
    let defaults = this.__defaults__();

    for (const field of fields) {
      let calculatedValue: any = null;

      if (field in data) {
        // explicit assignment
        calculatedValue = data[field];
      }

      if (calculatedValue === null && field in defaults) {
        // default values if no explicit value
        let defaultValue = defaults[field];
        if (defaultValue instanceof Array) {
          calculatedValue = [...defaultValue];
        } else if (defaultValue instanceof Function) {
          calculatedValue = defaultValue();
        } else {
          calculatedValue = defaultValue;
        }
      }
      Reflect.set(this, field, calculatedValue);
    }
  }

  protected __fields__(): string[] {
    return Reflect.getMetadata(FIELDS_META_KEY, this);
  }

  protected __field_types__(): { [key: string]: any } {
    return Reflect.getMetadata(FIELD_TYPES_META_KEY, this);
  }

  protected __defaults__(): { [key: string]: any } {
    return Reflect.getMetadata(DEFAULT_VALUES_META_KEY, this) || {};
  }

  protected __required_fields__(): string[] {
    return Reflect.getMetadata(REQUIRED_FIELDS_META_KEY, this) || [];
  }

  protected __rejected_fields__(): string[] {
    return Reflect.getMetadata(REJECTED_FIELDS_META_KEY, this) || [];
  }

  protected __restricted_fields__(): string[] {
    return Reflect.getMetadata(RESTRICTED_FIELDS_META_KEY, this) || [];
  }

  protected __auto_trim_fields__(): string[] {
    return Reflect.getMetadata(AUTO_TRIM_FIELDS_META_KEY, this) || [];
  }

  protected __async_computed__(): string[] {
    return Reflect.getMetadata(ASYNC_COMPUTED_PROPERTIES_META_KEY, this) || [];
  }

  static __key_field__: string | null = null;
  static __indexes__: Array<string | Array<any>> = [];

  isNew(): boolean {
    return this._id === null;
  }

  async save(skipCallback: boolean = true): Promise<void> {
    const isNew = this.isNew();

    if (!skipCallback) {
      await this._before_validation();
    }
    this._validate();

    this.__auto_trim_fields__().forEach((field: string) => {
      let value = this.__getField(field);
      if (value && value.hasOwnProperty('trim')) {
        this.__setField(field, value.trim());
      }
    });

    if (!skipCallback) {
      await this._before_save();
    }
    await this._save_to_db();
    if (!skipCallback) {
      await this._after_save(isNew);
    }
  }

  async update(
    data: { [key: string]: any },
    skipCallback: boolean = false
  ): Promise<void> {
    const rejected = this.__rejected_fields__();
    for (const field of this.__fields__()) {
      if (field in data && !rejected.includes(field) && field !== '_id') {
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

  protected __getField(key: string): any {
    if (process.env.NODE_ENV === 'development') {
      if (!Reflect.has(this, key)) {
        throw new Error(
          `Model has no field "${key}". This is strange and must be a bug`
        );
      }
    }

    const asyncComputed = this.__async_computed__();
    let value = Reflect.get(this, key);
    if (typeof value === 'function' && !asyncComputed.includes(key)) {
      return undefined;
    }
    return value;
  }

  protected __setField(key: string, value: any): void {
    if (process.env.NODE_ENV === 'development') {
      if (!Reflect.has(this, key)) {
        throw new Error(
          `Model has no field "${key}". This is strange and must be a bug`
        );
      }
    }
    Reflect.set(this, key, value);
  }

  protected __reloadFromObj(obj: { [key: string]: any }) {
    for (const field of this.__fields__()) {
      if (field === '_id') {
        continue;
      }
      if (field in obj) {
        this.__setField(field, obj[field]);
      }
    }
  }

  async dbUpdate(
    update: { [key: string]: any },
    when: { [key: string]: any } | null = null,
    reload: boolean = true,
    invalidateCache: boolean = true
  ) {
    const newData = await this.db().findAndUpdateObj(this, update, when);

    if (newData) {
      if (invalidateCache) {
        await this.invalidate();
      }
      if (reload) {
        const tmp = (this.constructor as any).fromData(newData);
        this.__reloadFromObj(tmp);
      }
    }
  }

  toObject(
    fields: string[] | null = null,
    includeRestricted: boolean = false
  ): { [key: string]: any } {
    const restricted = this.__restricted_fields__();
    const modelFields = this.__fields__();

    if (fields === null) {
      fields = modelFields;
    }

    let obj: { [key: string]: any } = {};
    for (const field of fields) {
      if (includeRestricted || !restricted.includes(field)) {
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
    const restricted = this.__restricted_fields__();
    const modelFields = this.__fields__();
    const asyncComputedFields = this.__async_computed__();

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
        if (typeof value !== 'undefined') {
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

  toString(): string {
    let data = this.toObject(null, true);
    let result = `<${this.constructor.name}`;
    for (let field of this.__fields__()) {
      result += ` ${field}=${data[field]}`;
    }
    return result + '>';
  }

  isValid(): boolean {
    try {
      this._validate();
    } catch (_) {
      return false;
    }
    return true;
  }

  protected _validate() {
    const fields = this.__fields__();
    const fieldTypes = this.__field_types__();
    const requiredFields = this.__required_fields__();
    const autoTrimFields = this.__auto_trim_fields__();

    fields.forEach(field => {
      if (field === '_id') return;
      const value = this.__getField(field);
      const fieldType = fieldTypes[field];
      const isRequired = requiredFields.includes(field);
      const autoTrim = autoTrimFields.includes(field);
      validateField(field, value, fieldType, isRequired, autoTrim);
      if (autoTrim && value && value.trim) this.__setField(field, value.trim());
    });
  }
  protected async _before_save() {}
  protected async _before_validation() {}
  protected async _before_delete() {}
  protected async _after_save(_isNew: boolean = true) {}
  protected async _after_delete() {}
  protected abstract async _save_to_db(): Promise<any>;
  protected abstract async _delete_from_db(): Promise<any>;
  async invalidate() {}

  static fromData<T extends AbstractModel>(
    this: new (...args: any[]) => T,
    data: { [key: string]: any }
  ): T {
    return new this(data);
  }
}
