import { MongoClient, Db } from 'mongodb';
import { BaseModel } from './model';
import { InvalidShardId, ShardIsReadOnly, DatabaseIsReadOnly } from './errors';
import { CommonObject, Nullable } from './util';
import { ModelCursor } from './model_cursor';

export type ShardConfig = {
  uri: string;
  dbname: string;
  options?: { [key: string]: any };
  open?: boolean;
};

export interface Logger {
  debug: (message: string, ...meta: any[]) => void;
  info: (message: string, ...meta: any[]) => void;
  warn: (message: string, ...meta: any[]) => void;
  error: (message: string, ...meta: any[]) => void;
}

export type UormOptions = {
  logQueries: boolean;
  logger?: Nullable<Logger>;
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
  private open: boolean;
  private logger: Nullable<Logger>;

  private constructor(
    private config: ShardConfig,
    private uormOptions: UormOptions,
    private shardId: Nullable<string>
  ) {
    if (uormOptions && uormOptions.logger) {
      this.logger = uormOptions.logger;
    } else {
      this.logger = null;
    }
  }

  async init() {
    let { uri, dbname, options = {}, open = true } = this.config;
    this.open = open;
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

  isOpen() {
    return this.open;
  }

  async getObject<T extends typeof BaseModel>(
    collection: string,
    query: Query,
    ctor: T
  ) {
    if (this.uormOptions.logQueries) {
      const msg = `Shard[${this.shardId ||
        'meta'}].${collection}.getObject(${JSON.stringify(query)})`;
      if (this.logger) this.logger.debug(msg);
      else console.log(msg);
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
      const msg = `Shard[${this.shardId ||
        'meta'}].${collection}.getObjectsCursor(${JSON.stringify(query)})`;
      if (this.logger) this.logger.debug(msg);
      else console.log(msg);
    }
    const coll = this.db().collection(collection);
    const mongoCursor = coll.find(query);
    return new ModelCursor(mongoCursor, ctor, this.shardId);
  }

  async saveObj<T extends BaseModel>(obj: T) {
    if (!this.open) {
      throw new ShardIsReadOnly(this.shardId || 'meta');
    }
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
    if (!this.open) {
      throw new ShardIsReadOnly(this.shardId || 'meta');
    }
    const coll = this.db().collection(obj.__collection__);
    await coll.deleteOne({ _id: obj._id });
  }

  async deleteQuery(collection: string, query: { [key: string]: any }) {
    if (!this.open) {
      throw new ShardIsReadOnly(this.shardId || 'meta');
    }
    if (this.uormOptions.logQueries) {
      const msg = `Shard[${this.shardId ||
        'meta'}].${collection}.deleteQuery(${JSON.stringify(query)})`;
      if (this.logger) this.logger.debug(msg);
      else console.log(msg);
    }
    const coll = this.db().collection(collection);
    return await coll.deleteMany(query);
  }

  async updateQuery(
    collection: string,
    query: { [key: string]: any },
    update: { [key: string]: any }
  ) {
    if (!this.open) {
      throw new ShardIsReadOnly(this.shardId || 'meta');
    }
    if (this.uormOptions.logQueries) {
      const msg = `Shard[${this.shardId ||
        'meta'}].${collection}.updateQuery(${JSON.stringify(
        query
      )}, ${JSON.stringify(update)})`;
      if (this.logger) this.logger.debug(msg);
      else console.log(msg);
    }
    const coll = this.db().collection(collection);
    return await coll.updateMany(query, update);
  }

  async findAndUpdateObject<T extends BaseModel>(
    obj: T,
    update: CommonObject,
    when: Nullable<CommonObject> = null
  ) {
    if (!this.open) {
      throw new ShardIsReadOnly(this.shardId || 'meta');
    }
    let query: CommonObject = { _id: obj._id };
    if (when) {
      query = {
        ...when,
        ...query,
      };
    }
    if (this.uormOptions.logQueries) {
      const msg = `Shard[${this.shardId || 'meta'}].${
        obj.__collection__
      }.findAndUpdateObject(${JSON.stringify(query)}, ${JSON.stringify(
        update
      )})`;
      if (this.logger) this.logger.debug(msg);
      else console.log(msg);
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

  RWShards(): { [key: string]: Shard } {
    if (!this.initialized) {
      throw new Error('DB is not initialized');
    }
    let shards: { [key: string]: Shard } = {};
    for (const shardId in this._shards) {
      if (this._shards[shardId].isOpen()) {
        shards[shardId] = this._shards[shardId];
      }
    }
    return shards;
  }

  getRandomRWShardId(): string {
    const shards = this.RWShards();
    const ids = Object.keys(shards);
    if (!ids.length) {
      throw new DatabaseIsReadOnly('No open shards found');
    }
    const idx = Math.floor(Math.random() * ids.length);
    return ids[idx];
  }

  getShard(shardId: string): Shard {
    if (shardId in this._shards) {
      return this._shards[shardId];
    }
    throw new InvalidShardId(shardId);
  }
}

export const db = new DB();
