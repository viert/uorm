import StorableModel from './storable_model';
import db, { DBShard } from './db';
import { Cursor, ObjectID } from 'mongodb';
import { MissingShardId } from 'errors';

export default class ShardedModel extends StorableModel {
  constructor(data: { [key: string]: any }, public readonly shardId: string) {
    super(data);
  }

  get db(): DBShard {
    return db.getShard(this.shardId);
  }

  static find(query: { [key: string]: any } = {}, shardId?: string): Cursor {
    if (!shardId) throw new MissingShardId();

    return db
      .getShard(shardId)
      .getObjs(this, this.__collection__, this._preprocessQuery(query));
  }

  static async findOne<T extends ShardedModel>(
    query: {
      [key: string]: any;
    },
    shardId?: string
  ): Promise<T | null> {
    if (!shardId) throw new MissingShardId();
    const obj = await db
      .getShard(shardId)
      .getObj(this, this.__collection__, this._preprocessQuery(query));
    return obj as T;
  }

  static async get<T extends ShardedModel>(
    expression: any,
    raiseNotFound: string | null = null,
    shardId?: string
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

    let result = await this.findOne(query, shardId);
    if (result === null && raiseNotFound !== null) {
      throw new Error(raiseNotFound);
    }
    return result as T | null;
  }
}
