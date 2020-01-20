import AbstractModel from './abstract_model';
import db, { DBShard } from './db';
import {
  Cursor,
  ObjectID,
  UpdateWriteOpResult,
  DeleteWriteOpResultObject,
} from 'mongodb';
import { MissingShardId, ModelDestroyed } from './errors';

export default class ShardedModel extends AbstractModel {
  constructor(public readonly shardId: string, data: { [key: string]: any }) {
    super(data);
  }

  db(): DBShard {
    return db.getShard(this.shardId);
  }

  async _delete_from_db() {
    await this.db().deleteObj(this);
  }

  async _save_to_db() {
    await this.db().saveObj(this);
  }

  static find(shardId: string, query: { [key: string]: any } = {}): Cursor {
    return db
      .getShard(shardId)
      .getObjs(
        this.fromData.bind(this),
        this.__collection__(),
        this._preprocessQuery(query)
      );
  }

  static async findOne<T extends typeof ShardedModel>(
    this: T,
    shardId: string,
    query: { [key: string]: any }
  ): Promise<InstanceType<T> | null> {
    if (!shardId) throw new MissingShardId();
    const obj = await db
      .getShard(shardId)
      .getObj(this.__collection__(), this._preprocessQuery(query));
    if (!obj) return null;
    return new this(shardId, obj) as InstanceType<T>;
  }

  static async get<T extends typeof ShardedModel>(
    this: T,
    shardId: string,
    expression: any,
    raiseNotFound: string | null = null
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

    let result = await this.findOne(shardId, query);
    if (result === null && raiseNotFound !== null) {
      throw new Error(raiseNotFound);
    }
    return result as InstanceType<T> | null;
  }

  async reload<T extends ShardedModel>(this: T): Promise<void> {
    if (this.isNew()) return;
    let constructor = this.constructor as typeof ShardedModel;

    let tmp = await constructor.findOne(this.shardId, {
      _id: this._id,
    });

    if (!tmp) {
      throw new ModelDestroyed();
    }

    this.__fields__().forEach(field => {
      if (field === '_id') return;
      this.__setField(field, (tmp as ShardedModel).__getField(field));
    });
  }

  static async updateMany(
    shardId: string,
    query: { [key: string]: any },
    attrs: { [key: string]: any }
  ): Promise<UpdateWriteOpResult> {
    return await db
      .getShard(shardId)
      .updateQuery(this.__collection__(), this._preprocessQuery(query), attrs);
  }

  static async destroyMany(
    shardId: string,
    query: {
      [key: string]: any;
    }
  ): Promise<DeleteWriteOpResultObject> {
    return await db
      .getShard(shardId)
      .deleteQuery(this.__collection__(), this._preprocessQuery(query));
  }

  static async destroyAll(shardId: string) {
    return await this.destroyMany(shardId, {});
  }
}
