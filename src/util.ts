import { BaseModel } from './model';
import { ModelSaveRequired } from './errors';

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
