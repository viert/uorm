import {
  Cursor,
  UpdateWriteOpResult,
  ObjectID,
  DeleteWriteOpResultObject,
} from 'mongodb';

import AbstractModel from './abstract_model';
import db, { DBShard } from './db';
import { ModelDestroyed } from './errors';

export default class StorableModel extends AbstractModel {
  static get db(): DBShard {
    return db.meta;
  }

  // a hack to make 'db' both static and instance property
  get db(): DBShard {
    return (this.constructor as typeof StorableModel).db;
  }

  async _delete_from_db() {
    await this.db.deleteObj(this);
  }

  async _save_to_db() {
    await this.db.saveObj(this);
  }

  static find(query: { [key: string]: any } = {}): Cursor {
    return this.db.getObjs(
      this,
      this.__collection__,
      this._preprocessQuery(query)
    );
  }

  static async findOne<T extends typeof StorableModel>(
    this: T,
    query: { [key: string]: any },
    ..._: any[]
  ): Promise<InstanceType<T> | null> {
    const obj = await this.db.getObj(
      this.__collection__,
      this._preprocessQuery(query)
    );
    if (!obj) return null;
    return new this(obj) as InstanceType<T>;
  }

  static async get<T extends typeof StorableModel>(
    this: T,
    expression: any,
    raiseNotFound: string | null = null,
    ..._: any[]
  ): Promise<InstanceType<T> | null> {
    if (expression === null) return null;
    let query: { [key: string]: any };
    if (expression instanceof ObjectID) {
      query = { _id: expression };
    } else {
      try {
        let idExpr = new ObjectID(expression);
        query = { _id: idExpr };
      } catch (e) {
        let keyField = `${this.__key_field__}`;
        query = { [keyField]: expression };
      }
    }

    let result = await this.findOne(query);
    if (result === null && raiseNotFound !== null) {
      throw new Error(raiseNotFound);
    }
    return result as InstanceType<T> | null;
  }

  static async destroyAll() {
    return await this.destroyMany({});
  }

  async reload<T extends StorableModel>(this: T): Promise<void> {
    if (this.isNew) return;
    let constructor = this.constructor as typeof StorableModel;

    let tmp = await constructor.findOne({
      _id: this._id,
    });

    if (!tmp) {
      throw new ModelDestroyed();
    }

    this.__fields__.forEach(field => {
      if (field === '_id') return;
      this.__setField(field, (tmp as StorableModel).__getField(field));
    });
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

  static async destroyMany(query: {
    [key: string]: any;
  }): Promise<DeleteWriteOpResultObject> {
    return await this.db.deleteQuery(
      this.__collection__,
      this._preprocessQuery(query)
    );
  }
}
