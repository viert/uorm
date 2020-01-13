import { Cursor, UpdateWriteOpResult, ObjectID } from 'mongodb';

import AbstractModel from './abstract_model';
import db, { DBShard } from './db';
import { ModelDestroyed } from './errors';

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
    return this.db.getObjs(this, '', this._preprocessQuery(query));
  }

  static async findOne<T extends StorableModel>(query: {
    [key: string]: any;
  }): Promise<T | null> {
    const obj = await this.db.getObj(
      this,
      this.__collection__,
      this._preprocessQuery(query)
    );
    return obj as T;
  }

  async update(data: { [key: string]: any }, skipCallback: boolean = false) {
    const rejected = this.__rejected_fields__;
    for (const field of this.__fields__) {
      if (field in data && !rejected.includes(field) && field !== '_id') {
        this.__setField(field, data[field]);
      }
    }
    return await this.save(skipCallback);
  }

  async reload(): Promise<this> {
    if (this.isNew) return this;
    let tmp = await (this.constructor as any).findOne({ _id: this._id });
    if (!tmp) {
      throw new ModelDestroyed();
    }

    this.__fields__.forEach(field => {
      if (field === '_id') return;
      this.__setField(field, tmp.__getField(field));
    });

    return this;
  }

  protected static _preprocessQuery(query: {
    [key: string]: any;
  }): { [key: string]: any } {
    return query;
  }

  static async updateMany(
    query: { [key: string]: any },
    attrs: { [key: string]: any }
  ): Promise<UpdateWriteOpResult> {
    return await this.db.updateQuery(
      this.__collection__,
      this._preprocessQuery(query),
      attrs
    );
  }

  static async get<T extends StorableModel>(
    expression: any,
    raiseNotFound: string | null = null
  ): Promise<T | null> {
    if (expression === null) return null;
    let query: { [key: string]: any };
    try {
      let idExpr = new ObjectID(expression);
      query = { _id: idExpr };
    } catch (e) {
      let keyField = `${this.__key_field__}`;
      query = { [keyField]: expression };
    }

    let result = await this.findOne(query);
    if (result === null && raiseNotFound !== null) {
      throw new Error(raiseNotFound);
    }
    return result as T | null;
  }
}
