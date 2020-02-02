import { MongoClient, Db } from 'mongodb';
import { BaseModel } from './model';
import { InvalidShardId } from './errors';
import { CommonObject, Nullable } from './util';
import { ModelCursor } from './model_cursor';

export type ShardConfig = {
  uri: string;
  dbname: string;
  options?: { [key: string]: any };
};

export type UormOptions = {
  logQueries: boolean;
};

export type DatabaseConfig = {
  meta: ShardConfig;
  shards: {
    [key: string]: ShardConfig;
  };
  options?: UormOptions;
};

export type Query = CommonObject;

export class Shard {
  private database: Nullable<Db> = null;
  private constructor(
    private config: ShardConfig,
    private uormOptions: UormOptions,
    private shardId: Nullable<string>
  ) {}

  async init() {
    let { uri, dbname, options = {} } = this.config;
    return new Promise(resolve => {
      MongoClient.connect(uri, options).then(client => {
        this.database = client.db(dbname);
        resolve();
      });
    });
  }

  static async create(
    config: ShardConfig,
    uormOptions: UormOptions,
    shardId: string | null
  ) {
    const shard = new Shard(config, uormOptions, shardId);
    await shard.init();
    return shard;
  }

  db() {
    if (this.database === null) {
      throw new Error('shard not initialized');
    }
    return this.database;
  }

  async getObject<T extends typeof BaseModel>(
    collection: string,
    query: Query,
    ctor: T
  ) {
    if (this.uormOptions.logQueries) {
      console.log(
        `Shard[${this.shardId || 'meta'}].getObject(${JSON.stringify(query)})`
      );
    }
    const coll = this.db().collection(collection);
    const obj = await coll.findOne(query);
    if (obj === null) {
      return null;
    }
    if (this.shardId) {
      obj['shard_id'] = this.shardId;
    }
    return ctor.make(obj) as InstanceType<T>;
  }

  getObjectsCursor<T extends typeof BaseModel>(
    collection: string,
    query: Query,
    ctor: T
  ) {
    if (this.uormOptions.logQueries) {
      console.log(
        `Shard[${this.shardId || 'meta'}].getObjectsCursor(${JSON.stringify(
          query
        )})`
      );
    }
    const coll = this.db().collection(collection);
    const mongoCursor = coll.find(query);
    return new ModelCursor(mongoCursor, ctor, this.shardId);
  }

  async saveObj<T extends BaseModel>(obj: T) {
    const coll = this.db().collection(obj.__collection__);
    let data = obj.toObject(null, true);
    if (obj.isNew()) {
      delete data['_id'];
      const inserted = await coll.insertOne(data);
      obj._id = inserted.insertedId;
    } else {
      await coll.replaceOne({ _id: obj._id }, data, { upsert: true });
    }
  }

  async deleteObj<T extends BaseModel>(obj: T) {
    const coll = this.db().collection(obj.__collection__);
    await coll.deleteOne({ _id: obj._id });
  }

  async deleteQuery(collection: string, query: { [key: string]: any }) {
    if (this.uormOptions.logQueries) {
      console.log(
        `Shard[${this.shardId || 'meta'}].deleteQuery(${JSON.stringify(query)})`
      );
    }
    const coll = this.db().collection(collection);
    return await coll.deleteMany(query);
  }

  async updateQuery(
    collection: string,
    query: { [key: string]: any },
    update: { [key: string]: any }
  ) {
    if (this.uormOptions.logQueries) {
      console.log(
        `Shard[${this.shardId || 'meta'}].updateQuery(${JSON.stringify(
          query
        )}, ${JSON.stringify(update)})`
      );
    }
    const coll = this.db().collection(collection);
    return await coll.updateMany(query, update);
  }

  async findAndUpdateObject<T extends BaseModel>(
    obj: T,
    update: CommonObject,
    when: Nullable<CommonObject> = null
  ) {
    let query: CommonObject = { _id: obj._id };
    if (when) {
      query = {
        ...when,
        ...query,
      };
    }
    if (this.uormOptions.logQueries) {
      console.log(
        `Shard[${this.shardId || 'meta'}].findAndUpdateObject(${JSON.stringify(
          query
        )}, ${JSON.stringify(update)})`
      );
    }
    const coll = this.db().collection(obj.__collection__);
    const result = await coll.findOneAndUpdate(query, update, {
      returnOriginal: false,
    });
    let newData: CommonObject = result.value;
    if (newData && this.shardId) {
      newData['shard_id'] = this.shardId;
    }
    return newData;
  }
}

class DB {
  private _meta: Shard;
  private _shards: { [key: string]: Shard } = {};
  initialized: boolean = false;

  async init(config: DatabaseConfig): Promise<void> {
    let uormOptions: UormOptions = config.options || { logQueries: false };
    this._meta = await Shard.create(config.meta, uormOptions, null);
    for (const shardId in config.shards) {
      this._shards[shardId] = await Shard.create(
        config.shards[shardId],
        uormOptions,
        shardId
      );
    }
    this.initialized = true;
  }

  meta(): Shard {
    if (!this.initialized) {
      throw new Error('DB is not initialized');
    }
    return this._meta;
  }

  shards(): { [key: string]: Shard } {
    if (!this.initialized) {
      throw new Error('DB is not initialized');
    }
    return this._shards;
  }

  getShard(shardId: string): Shard {
    if (shardId in this._shards) {
      return this._shards[shardId];
    }
    throw new InvalidShardId(shardId);
  }
}

export const db = new DB();
