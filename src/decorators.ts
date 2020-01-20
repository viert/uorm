import AbstractModel from './abstract_model';
import { ModelSaveRequired } from './errors';

export const FIELDS_META_KEY = 'uorm:fields';
export const FIELD_TYPES_META_KEY = 'uorm:field_types';
export const REQUIRED_FIELDS_META_KEY = 'uorm:required_fields';
export const DEFAULT_VALUES_META_KEY = 'uorm:field_defaults';
export const REJECTED_FIELDS_META_KEY = 'uorm:rejected_fields';
export const RESTRICTED_FIELDS_META_KEY = 'uorm:restricted_fields';
export const AUTO_TRIM_FIELDS_META_KEY = 'uorm:auto_trim_fields';
export const ASYNC_COMPUTED_PROPERTIES_META_KEY = 'uorm:async_computed_fields';

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
    let ormFields: string[] = [];
    if (Reflect.hasMetadata(FIELDS_META_KEY, target)) {
      ormFields = [...Reflect.getMetadata(FIELDS_META_KEY, target)];
    }
    ormFields.push(propertyName);
    Reflect.defineMetadata(FIELDS_META_KEY, ormFields, target);

    let ormFieldTypes = {
      [propertyName]: type,
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

export const StringField = (config: FieldConfig = {}) =>
  setupField(FieldType.string, config);
export const NumberField = (config: FieldConfig = {}) =>
  setupField(FieldType.number, config);
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
    if (
      descriptor &&
      descriptor.value &&
      descriptor.value.constructor &&
      descriptor.value.constructor.name === 'AsyncFunction'
    ) {
      let computed: string[] = [];
      if (Reflect.hasMetadata(ASYNC_COMPUTED_PROPERTIES_META_KEY, target)) {
        computed = Reflect.getMetadata(
          ASYNC_COMPUTED_PROPERTIES_META_KEY,
          target
        );
      }
      computed.push(propertyName);
      Reflect.defineMetadata(
        ASYNC_COMPUTED_PROPERTIES_META_KEY,
        computed,
        target
      );
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
