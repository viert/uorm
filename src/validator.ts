import { FieldType } from './fields';
import { FieldRequired, ValidationError } from './errors';
import { ObjectID } from 'mongodb';

export function validateField(
  field: string,
  value: any,
  type: FieldType,
  required: boolean,
  autotrim: boolean
) {
  // null fields are ok
  if (value === null) {
    if (required) {
      throw new FieldRequired(field);
    }
    return;
  }

  switch (type) {
    case FieldType.any:
      return;
    case FieldType.boolean:
      if (value instanceof Boolean || typeof value === 'boolean') return;
      throw new ValidationError(`Field ${field} must be a boolean`);
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
