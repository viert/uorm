import { MongoClient, Db, Cursor } from 'mongodb';
import AbstractModel from './abstract_model';
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

  async get_obj<T extends AbstractModel>(
    ModelClass: new (data: Object) => T,
    collection: string,
    query: Object
  ): Promise<T> {
    const coll = this.db.collection(collection);
    const result = await coll.findOne(query);
    return new ModelClass(result);
  }

  async get_objs<T extends AbstractModel>(
    ModelClass: new (data: Object) => T,
    collection: string,
    query: Object
  ): Promise<Cursor> {
    const coll = this.db.collection(collection);
    const cursor = coll.find(query);
    return createObjectsCursor(cursor, ModelClass);
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

export { DB };
