import { BaseModel } from './model';
import { ModelSaveRequired } from './errors';
import { ObjectID } from 'mongodb';

export function snakeCase(name: string) {
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

export type CommonObject = { [key: string]: any };
export type Nullable<T> = T | null;

export function SaveRequired<T extends BaseModel>(
  _target: T,
  _propertyName: string,
  descriptor: PropertyDescriptor
) {
  const original = descriptor.value;
  descriptor.value = function(...args: any[]) {
    const self = this as T;
    if (self.isNew()) {
      throw new ModelSaveRequired();
    }
    return original.apply(this, args);
  };
}

const primitives = {
  string: true,
  number: true,
  boolean: true,
};

export function deepcopy(obj: any): any {
  if (typeof obj in primitives) return obj;
  if (obj instanceof ObjectID) return new ObjectID(obj);
  if (obj instanceof Array) return obj.map(deepcopy);

  let nobj: CommonObject = {};
  for (const prop in obj) {
    nobj[prop] = deepcopy(obj[prop]);
  }

  return nobj;
}
