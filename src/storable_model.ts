import { Cursor } from 'mongodb';

import AbstractModel from './abstract_model';
import db, { DBShard } from './db';

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

export default class StorableModel extends AbstractModel {
  protected static _coll: string | null = null;

  static get __collection__(): string {
    if (!this._coll) {
      this._coll = snakeCase(this.constructor.name);
    }
    return this._coll;
  }

  // this one is a hack to get the static __collection__ easily from
  // an instance
  get __collection__(): string {
    return (this.constructor as any)['__collection__'];
  }

  static get db(): DBShard {
    return db.meta;
  }

  async _delete_from_db() {
    await StorableModel.db.deleteObj(this);
  }

  async _save_to_db() {
    await StorableModel.db.saveObj(this);
  }

  static find(query: { [key: string]: any }): Cursor {
    return this.db.getObjs(StorableModel, '', query);
  }

  static async findOne<T extends StorableModel>(query: {
    [key: string]: any;
  }): Promise<T> {
    return this.db.getObj(
      this.constructor,
      this.__collection__,
      query
    ) as Promise<T>;
  }
}
