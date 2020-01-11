import AbstractModel from './abstract_model';
import db from 'db';

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
  private _coll: string | null = null;

  get __collection__(): string {
    if (!this._coll) {
      this._coll = snakeCase(this.constructor.name);
    }
    return this._coll;
  }

  async _delete_from_db() {
    await db.meta.deleteObj(this);
  }

  async _save_to_db() {
    await db.meta.saveObj(this);
  }
}
