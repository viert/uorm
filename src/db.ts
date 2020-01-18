import {
  MongoClient,
  Db,
  Cursor,
  DeleteWriteOpResultObject,
  UpdateWriteOpResult,
} from 'mongodb';

import AbstractModel from './abstract_model';
import { InvalidShardId } from './errors';

export interface DBConfig {
  uri: string;
  options?: Object;
  dbname: string;
}

function createObjectsCursor<T extends AbstractModel>(
  cursor: Cursor,
  shardId: string | null,
  ctor: (data: { [key: string]: any }) => T
) {
  return new Proxy(cursor, {
    get(target, propKey) {
      switch (propKey) {
        case 'shardId':
          return shardId;
        case 'forEach':
          return (
            callback: (item: { [key: string]: any }, ...rest: any[]) => void
          ) => {
            cursor.forEach((item: { [key: string]: any }, ...rest: any[]) => {
              if (shardId) {
                item['shard_id'] = shardId;
              }
              let obj: T = ctor(item);
              callback(obj, ...rest);
            });
          };
        case Symbol.asyncIterator:
          return async function* asyncIter() {
            for await (const item of cursor) {
              if (shardId) {
                item['shard_id'] = shardId;
              }
              yield ctor(item);
            }
          };
        case 'next':
          return async () => {
            let obj = await cursor.next();
            return ctor(obj);
          };
        case 'toArray':
          return async () => {
            let objs = await cursor.toArray();
            return objs.map(ctor);
          };
        default:
          return Reflect.get(target, propKey);
      }
    },
  });
}

export class DBShard {
  private config: DBConfig;
  private database: Db | null = null;
  private mongoClient: new (...args: any[]) => MongoClient = MongoClient;

  private constructor(
    config: DBConfig,
    private shardId: string | null = null,
    overrideMongoClient: any
  ) {
    let { uri, dbname, options = {} } = config;
    this.config = { uri, dbname, options };
    if (overrideMongoClient) {
      this.mongoClient = overrideMongoClient;
    }
  }

  async initConnection() {
    // console.log('creating a read/write mongo connection');
    const client = new this.mongoClient(this.config.uri, this.config.options);
    return new Promise((resolve, reject) => {
      client.connect((err: Error | null) => {
        if (err === null) {
          this.database = client.db(this.config.dbname);
          return resolve(null);
        }
        return reject(err);
      });
    });
  }

  static async create(
    config: DBConfig,
    shardId: string | null = null,
    overrideMongoClient: any = null
  ): Promise<DBShard> {
    const shard = new DBShard(config, shardId, overrideMongoClient);
    await shard.initConnection();
    return shard;
  }

  get db() {
    if (this.database === null) throw new Error('not initialized');
    return this.database;
  }

  async getObj(
    collection: string,
    query: { [key: string]: any }
  ): Promise<{ [key: string]: any } | null> {
    const coll = this.db.collection(collection);
    const obj = await coll.findOne(query);
    if (obj === null) {
      return null;
    }
    return obj as { [key: string]: any };
  }

  getObjs<T extends AbstractModel>(
    ctor: (...args: any[]) => T,
    collection: string,
    query: { [key: string]: any }
  ): Cursor {
    const coll = this.db.collection(collection);
    const cursor = coll.find(query);
    return createObjectsCursor(cursor, this.shardId, ctor);
  }

  async getObjsProjected(
    collection: string,
    query: { [key: string]: any },
    projection: { [key: string]: boolean }
  ): Promise<Cursor> {
    const coll = this.db.collection(collection);
    const cursor = coll.find(query).project(projection);
    return cursor;
  }

  async saveObj<T extends AbstractModel>(obj: T): Promise<void> {
    const coll = this.db.collection(obj.__collection__);

    if (obj.isNew) {
      let data = obj.toObject(null, true);
      delete data['_id'];

      const insertedObj = await coll.insertOne(data);
      obj._id = insertedObj.insertedId;
    } else {
      await coll.replaceOne({ _id: obj._id }, obj.toObject(null, true), {
        upsert: true,
      });
    }
  }

  async deleteObj<T extends AbstractModel>(obj: T): Promise<void> {
    if (obj.isNew) return;
    const coll = this.db.collection(obj.__collection__);
    await coll.deleteOne({ _id: obj._id });
  }

  async deleteQuery(
    collection: string,
    query: { [key: string]: any }
  ): Promise<DeleteWriteOpResultObject> {
    const coll = this.db.collection(collection);
    return await coll.deleteMany(query);
  }

  async updateQuery(
    collection: string,
    query: { [key: string]: any },
    update: { [key: string]: any }
  ): Promise<UpdateWriteOpResult> {
    const coll = this.db.collection(collection);
    return await coll.updateMany(query, update);
  }
}

class DB {
  private _meta: DBShard;
  private _shards: { [key: string]: DBShard } = {};
  initialized: boolean = false;

  static async create(config: {
    meta: DBConfig;
    shards: { [key: string]: DBConfig };
  }): Promise<DB> {
    const db = new DB();
    await db.init(config);
    return db;
  }

  async init(
    config: {
      meta: DBConfig;
      shards: { [key: string]: DBConfig };
    },
    overrideMongoClient: any = null
  ): Promise<void> {
    this._meta = await DBShard.create(config.meta, null, overrideMongoClient);
    for (const shardId in config.shards) {
      this._shards[shardId] = await DBShard.create(
        config.shards[shardId],
        shardId,
        overrideMongoClient
      );
    }
    this.initialized = true;
  }

  getShard(shardId: string): DBShard {
    if (shardId in this._shards) {
      return this._shards[shardId];
    }
    throw new InvalidShardId(shardId);
  }

  get meta(): DBShard {
    if (!this.initialized) {
      throw new Error('DB is not initialized');
    }
    return this._meta;
  }

  get shards(): { [key: string]: DBShard } {
    if (!this.initialized) {
      throw new Error('DB is not initialized');
    }
    return this._shards;
  }
}

let db: DB = new DB();

export default db;
