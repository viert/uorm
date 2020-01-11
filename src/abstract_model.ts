import 'reflect-metadata';
import { ObjectID } from 'bson';
import { InvalidFieldType, FieldRequired, ModelSaveRequired } from './errors';

const FIELDS_META_KEY = 'uorm:fields';
const FIELD_TYPES_META_KEY = 'uorm:field_types';
const REQUIRED_FIELDS_META_KEY = 'uorm:required_fields';
const DEFAULT_VALUES_META_KEY = 'uorm:field_defaults';
const REJECTED_FIELDS_META_KEY = 'uorm:rejected_fields';
const RESTRICTED_FIELDS_META_KEY = 'uorm:restricted_fields';
const AUTO_TRIM_FIELDS_META_KEY = 'uorm:auto_trim_fields';

function validateType(value: any, type: any): boolean {
  return (
    value instanceof type ||
    (typeof value === 'string' && type.name === 'String') ||
    (typeof value === 'number' && type.name === 'Number') ||
    (typeof value === 'boolean' && type.name === 'Boolean')
  );
}

/**
 * Field decorates a StorableModel property to make it a storable field
 * @param config
 *    optional parameter with field settings like
 *    - required
 *    - rejected
 *    - restricted
 *    - autoTrim
 *    - defaultValue
 *
 */
export function Field(
  config: {
    required?: boolean;
    rejected?: boolean;
    restricted?: boolean;
    autoTrim?: boolean;
    defaultValue?: any;
  } = {}
): (target: any, propertyName: string) => void {
  const {
    defaultValue = null,
    autoTrim = true,
    rejected = false,
    restricted = false,
    required = false,
  } = config;

  return function __decorate(target: any, propertyName: string) {
    const fieldType = Reflect.getMetadata('design:type', target, propertyName);

    let ormFields = [propertyName];
    if (Reflect.hasMetadata(FIELDS_META_KEY, target)) {
      ormFields = [
        ...Reflect.getMetadata(FIELDS_META_KEY, target),
        ...ormFields,
      ];
    }
    Reflect.defineMetadata(FIELDS_META_KEY, ormFields, target);

    let ormFieldTypes = {
      [propertyName]: fieldType,
    };
    if (Reflect.hasMetadata(FIELD_TYPES_META_KEY, target)) {
      ormFieldTypes = {
        ...Reflect.getMetadata(FIELD_TYPES_META_KEY, target),
        ...ormFieldTypes,
      };
    }
    Reflect.defineMetadata(FIELD_TYPES_META_KEY, ormFieldTypes, target);

    let ormDefaultValues: { [key: string]: any } = {};
    if (Reflect.hasMetadata(DEFAULT_VALUES_META_KEY, target)) {
      ormDefaultValues = Reflect.getMetadata(DEFAULT_VALUES_META_KEY, target);
    }

    if (defaultValue) {
      ormDefaultValues[propertyName] = defaultValue;
    }
    Reflect.defineMetadata(DEFAULT_VALUES_META_KEY, ormDefaultValues, target);

    const settings: Array<{ value: boolean; key: string }> = [
      { value: required, key: REQUIRED_FIELDS_META_KEY },
      { value: restricted, key: RESTRICTED_FIELDS_META_KEY },
      { value: rejected, key: REJECTED_FIELDS_META_KEY },
      { value: autoTrim, key: AUTO_TRIM_FIELDS_META_KEY },
    ];

    for (let option of settings) {
      let specFields: Array<string> = [];
      if (Reflect.hasMetadata(option.key, target))
        specFields = Reflect.getMetadata(option.key, target);
      if (option.value) {
        specFields = [...specFields, propertyName];
      }
      Reflect.defineMetadata(option.key, specFields, target);
    }
  };
}

export function SaveRequired<T extends AbstractModel>(
  _target: T,
  _propertyName: string,
  descriptor: PropertyDescriptor
) {
  const original = descriptor.value;
  descriptor.value = function(...args: any[]) {
    if ((this as T).isNew) {
      throw new ModelSaveRequired();
    }
    return original.apply(this, args);
  };
}

export default abstract class AbstractModel {
  @Field() _id: ObjectID | null;

  constructor(data: { [key: string]: any } = {}) {
    let fields = this.__fields__;
    let defaults = this.__defaults__;

    for (const field of fields) {
      let calculatedValue: any;

      if (field in data) {
        // explicit assignment
        calculatedValue = data[field];
      } else if (field in defaults) {
        // default values if no explicit value
        let defaultValue = defaults[field];
        if (defaultValue instanceof Array) {
          calculatedValue = [...defaultValue];
        } else if (defaultValue instanceof Object) {
          calculatedValue = { ...defaultValue };
        } else if (defaultValue instanceof Function) {
          calculatedValue = defaultValue();
        } else {
          calculatedValue = defaultValue;
        }
      } else {
        // null for all other fields
        calculatedValue = null;
      }
      Reflect.set(this, field, calculatedValue);
    }
  }

  protected get __fields__(): string[] {
    return Reflect.getMetadata(FIELDS_META_KEY, this);
  }

  protected get __field_types__(): { [key: string]: any } {
    return Reflect.getMetadata(FIELD_TYPES_META_KEY, this);
  }

  protected get __defaults__(): { [key: string]: any } {
    return Reflect.getMetadata(DEFAULT_VALUES_META_KEY, this);
  }

  protected get __required_fields__(): string[] {
    return Reflect.getMetadata(REQUIRED_FIELDS_META_KEY, this);
  }

  protected get __rejected_fields__(): string[] {
    return Reflect.getMetadata(REJECTED_FIELDS_META_KEY, this);
  }

  protected get __restricted_fields__(): string[] {
    return Reflect.getMetadata(RESTRICTED_FIELDS_META_KEY, this);
  }

  protected get __auto_trim_fields__(): string[] {
    return Reflect.getMetadata(AUTO_TRIM_FIELDS_META_KEY, this);
  }

  __key_field__: string | null = null;
  __indexes__: Array<string | Array<any>> = [];

  get isNew(): boolean {
    return this._id === null;
  }

  async save(skipCallback: boolean = true) {
    const isNew = this.isNew;

    if (!skipCallback) {
      await this._before_validation();
    }
    this._validate();

    this.__auto_trim_fields__.forEach((field: string) => {
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

    return this;
  }

  async destroy(skipCallback: boolean = false) {
    if (this.isNew) {
      return this;
    }

    if (!skipCallback) {
      await this._before_delete();
    }
    await this._delete_from_db();

    if (!skipCallback) {
      await this._after_delete();
    }
    this._id = null;

    return this;
  }

  protected __getField(key: string): any {
    if (process.env.NODE_ENV === 'development') {
      if (!Reflect.has(this, key)) {
        throw new Error(
          `Model has no field "${key}". This is strange and must be a bug`
        );
      }
    }
    let value = Reflect.get(this, key);
    if (typeof value === 'function') {
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

  toObject(
    fields: string[] | null = null,
    includeRestricted: boolean = false
  ): { [key: string]: any } {
    let restricted = this.__restricted_fields__;

    if (fields === null) {
      fields = this.__fields__;
    }

    return fields.reduce((acc: { [key: string]: any }, field: string) => {
      if (includeRestricted || !restricted.includes(field)) {
        let value = this.__getField(field);
        if (typeof value !== 'undefined') {
          acc[field] = value;
        }
      }
      return acc;
    }, {});
  }

  toString(): string {
    let data = this.toObject(null, true);
    let result = `<${this.constructor.name}`;
    for (let field of this.__fields__) {
      result += ` ${field}=${data[field]}`;
    }
    return result + '>';
  }

  get isValid(): boolean {
    try {
      this._validate();
    } catch (_) {
      return false;
    }
    return true;
  }

  protected _validate() {
    let fields = this.__fields__;
    let fieldTypes = this.__field_types__;
    let requiredFields = this.__required_fields__;
    let autoTrimFields = this.__auto_trim_fields__;

    for (let field of fields) {
      if (field === '_id') continue;
      let value = this.__getField(field);

      // check field type
      let fieldType = fieldTypes[field];
      if (!validateType(value, fieldType)) {
        let valueType = value.constructor;
        throw new InvalidFieldType(
          `field "${field}" value has invalid type ${valueType.name}, ${fieldType.name} expected`
        );
      }

      // autotrim runs before "required" check
      // to throw errors on whitespace-only strings
      if (fieldType.name === 'String' && autoTrimFields.includes(field)) {
        value = value.trim();
        this.__setField(field, value);
      }

      // check required
      if (requiredFields.includes(field) && !value) {
        throw new FieldRequired(field);
      }
    }
  }
  protected async _before_save() {}
  protected async _before_validation() {}
  protected async _before_delete() {}
  protected async _after_save(_isNew: boolean = true) {}
  protected async _after_delete() {}
  protected abstract async _save_to_db(): Promise<any>;
  protected abstract async _delete_from_db(): Promise<any>;
  async invalidate() {}
}
