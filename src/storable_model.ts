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

  // a hack to make '__collection__' both static and instance property
  get __collection__(): string {
    return (this.constructor as any)['__collection__'];
  }

  static get db(): DBShard {
    return db.meta;
  }

  // a hack to make 'db' both static and instance property
  get db(): DBShard {
    return (this.constructor as any)['db'];
  }

  async _delete_from_db() {
    await this.db.deleteObj(this);
  }

  async _save_to_db() {
    await this.db.saveObj(this);
  }

  static find(query: { [key: string]: any }): Cursor {
    return this.db.getObjs(this, '', query);
  }

  static async findOne<T extends StorableModel>(query: {
    [key: string]: any;
  }): Promise<T> {
    const obj = await this.db.getObj(this, this.__collection__, query);
    return obj as T;
  }
}
