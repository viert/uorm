import {
  MongoClient,
  Db,
  Cursor,
  DeleteWriteOpResultObject,
  UpdateWriteOpResult,
} from 'mongodb';

import AbstractModel from './abstract_model';
import StorableModel from './storable_model';
import { InvalidShardId } from './errors';

interface DBConfig {
  uri: string;
  options?: Object;
  dbname: string;
}

function createObjectsCursor<T extends AbstractModel>(
  cursor: Cursor,
  ModelClass: new (data: Object) => T
) {
  return new Proxy(cursor, {
    get(target, propKey) {
      switch (propKey) {
        case 'forEach':
          return (callback: (item: object, ...rest: any[]) => void) => {
            cursor.forEach((item: object, ...rest: any[]) => {
              let obj: T = new ModelClass(item);
              callback(obj, ...rest);
            });
          };
        case Symbol.asyncIterator:
          return async function* asyncIter() {
            for await (const item of cursor) {
              yield new ModelClass(item);
            }
          };
        default:
          return Reflect.get(target, propKey);
      }
    },
  });
}

class DBShard {
  private config: DBConfig;
  private database: Db | null = null;

  private constructor(config: DBConfig, private shardId: string | null = null) {
    let { uri, dbname, options = {} } = config;
    this.config = { uri, dbname, options };
    console.log(`instantiated shard ${this.shardId}`);
  }

  async initConnection() {
    console.log('creating a read/write mongo connection');
    const client = new MongoClient(this.config.uri, this.config.options);
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
    shardId: string | null = null
  ): Promise<DBShard> {
    const shard = new DBShard(config, shardId);
    await shard.initConnection();
    return shard;
  }

  get db() {
    if (this.database === null) throw new Error('not initialized');
    return this.database;
  }

  async getObj<T extends AbstractModel>(
    ModelClass: new (data: Object) => T,
    collection: string,
    query: Object
  ): Promise<T> {
    const coll = this.db.collection(collection);
    const result = await coll.findOne(query);
    return new ModelClass(result);
  }

  async getObjs<T extends AbstractModel>(
    ModelClass: new (data: Object) => T,
    collection: string,
    query: { [key: string]: any }
  ): Promise<Cursor> {
    const coll = this.db.collection(collection);
    const cursor = coll.find(query);
    return createObjectsCursor(cursor, ModelClass);
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

  async saveObj<T extends StorableModel>(obj: T): Promise<void> {
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

  async deleteObj<T extends StorableModel>(obj: T): Promise<void> {
    if (obj.isNew) return;
    const coll = this.db.collection(obj.__collection__);
    coll.deleteOne({ _id: obj._id });
  }

  async deleteQuery(
    collection: string,
    query: { [key: string]: any }
  ): Promise<DeleteWriteOpResultObject> {
    const coll = this.db.collection(collection);
    return coll.deleteMany(query);
  }

  async updateQuery(
    collection: string,
    query: { [key: string]: any },
    update: { [key: string]: any }
  ): Promise<UpdateWriteOpResult> {
    const coll = this.db.collection(collection);
    return coll.updateMany(query, update);
  }
}

class DB {
  meta: DBShard;
  shards: { [key: string]: DBShard };

  static async create(config: {
    meta: DBConfig;
    shards: { [key: string]: DBConfig };
  }): Promise<DB> {
    const db = new DB();
    db.meta = await DBShard.create(config.meta);
    for (const shardId in config.shards) {
      db.shards[shardId] = await DBShard.create(config.shards[shardId]);
    }
    return db;
  }

  getShard(shardId: string): DBShard {
    if (shardId in this.shards) {
      return this.shards[shardId];
    }
    throw new InvalidShardId(shardId);
  }
}

let db: DB;

export async function initDB(config: {
  meta: DBConfig;
  shards: { [key: string]: DBConfig };
}) {
  db = await DB.create(config);
}

export default db;
