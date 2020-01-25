import AbstractModel from './abstract_model';
import { ModelSaveRequired } from './errors';

interface FieldConfig {
  required?: boolean;
  rejected?: boolean;
  restricted?: boolean;
  autoTrim?: boolean;
  defaultValue?: any;
}

export enum FieldType {
  any = 'any',
  number = 'number',
  string = 'string',
  array = 'array',
  objectid = 'objectid',
  datetime = 'datetime',
  object = 'object',
  boolean = 'boolean',
}

function setupField(
  type: FieldType,
  config: FieldConfig = {}
): (target: any, propertyName: string) => void {
  const {
    defaultValue = null,
    autoTrim = true,
    rejected = false,
    restricted = false,
    required = false,
  } = config;

  return function __decorate(target: any, propertyName: string) {
    let ctor = target.constructor;
    if (!('__fields__' in ctor)) {
      throw new Error(
        '@...Field decorators can only be used with AbstractModel subclasses'
      );
    }
    ctor.__fields__.push(propertyName);
    ctor.__field_types__ = {
      ...ctor.__field_types__,
      [propertyName]: type,
    };

    if (defaultValue !== null) {
      ctor.__defaults__ = {
        ...ctor.__defaults__,
        [propertyName]: defaultValue,
      };
    }

    if (required) ctor.__required_fields__.push(propertyName);
    if (restricted) ctor.__restricted_fields__.push(propertyName);
    if (rejected) ctor.__rejected_fields__.push(propertyName);
    if (autoTrim) ctor.__auto_trim_fields__.push(propertyName);
  };
}

export const StringField = (config: FieldConfig = {}) =>
  setupField(FieldType.string, config);
export const NumberField = (config: FieldConfig = {}) =>
  setupField(FieldType.number, config);
export const BooleanField = (config: FieldConfig = {}) =>
  setupField(FieldType.boolean, config);
export const ObjectIdField = (config: FieldConfig = {}) =>
  setupField(FieldType.objectid, config);
export const ObjectField = (config: FieldConfig = {}) =>
  setupField(FieldType.object, config);
export const AnyField = (config: FieldConfig = {}) =>
  setupField(FieldType.any, config);
export const ArrayField = (config: FieldConfig = {}) =>
  setupField(FieldType.array, config);
export const DatetimeField = (config: FieldConfig = {}) =>
  setupField(FieldType.datetime, config);

export function AsyncComputed() {
  return function __decorate(
    target: any,
    propertyName: string,
    descriptor: PropertyDescriptor
  ) {
    let ctor = target.constructor;
    if (!('__async_computed__' in ctor)) {
      throw new Error(
        'AsyncComputed decorator can only be used in subclasses of AbstractModel'
      );
    }
    if (
      descriptor &&
      descriptor.value &&
      descriptor.value.constructor &&
      descriptor.value.constructor.name === 'AsyncFunction'
    ) {
      ctor.__async_computed__.push(propertyName);
    } else {
      throw new TypeError(`${propertyName} is not an async method`);
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
    if ((this as T).isNew()) {
      throw new ModelSaveRequired();
    }
    return original.apply(this, args);
  };
}
