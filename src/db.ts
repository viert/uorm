import debug from 'debug';
import { MongoClient, Db } from 'mongodb';
import { BaseModel } from './model';
import { InvalidShardId, ShardIsReadOnly, DatabaseIsReadOnly } from './errors';
import { CommonObject, Nullable } from './util';
import { ModelCursor } from './model_cursor';
import { CacheAdapter, SimpleCacheAdapter, MemcachedCacheAdapter } from 'cache';

export type ShardConfig = {
  uri: string;
  dbname: string;
  options?: { [key: string]: any };
  open?: boolean;
};

export type CacheConfig = {
  type: 'simple' | 'memcached';
  backends?: string[];
  options?: CommonObject;
};

export type DatabaseConfig = {
  meta: ShardConfig;
  shards: {
    [key: string]: ShardConfig;
  };
  cache?: CacheConfig;
};

export type Query = CommonObject;

const queryLogger = debug('uorm:query');
const DEFAULT_CACHE_CONFIG: CacheConfig = {
  type: 'simple',
  backends: [],
  options: {},
};

export class Shard {
  private database: Nullable<Db> = null;
  private open: boolean;
  private client: MongoClient;

  private constructor(
    private config: ShardConfig,
    private shardId: Nullable<string>
  ) {}

  async init() {
    let { uri, dbname, options = {}, open = true } = this.config;
    this.open = open;
    this.client = await MongoClient.connect(uri, options);
    this.database = this.client.db(dbname);
  }

  static async create(config: ShardConfig, shardId: string | null) {
    const shard = new Shard(config, shardId);
    await shard.init();
    return shard;
  }

  async close() {
    return await this.client.close();
  }

  get name() {
    return this.shardId || 'meta';
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
    queryLogger(
      `Shard[${this.name}].${collection}.getObject(${JSON.stringify(query)})`
    );

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
    queryLogger(
      `Shard[${this.name}].${collection}.getObjectsCursor(${JSON.stringify(
        query
      )})`
    );
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
    queryLogger(
      `Shard[${this.name}].${collection}.deleteQuery(${JSON.stringify(query)})`
    );
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

    queryLogger(
      `Shard[${this.name}].${collection}.updateQuery(${JSON.stringify(query)})`
    );
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
    queryLogger(
      `Shard[${this.name}].${
        obj.__collection__
      }.findAndUpdateObject(${JSON.stringify(query)}, ${JSON.stringify(
        update
      )})`
    );
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
  private _cache: CacheAdapter;
  initialized: boolean = false;

  async init(config: DatabaseConfig): Promise<void> {
    this._meta = await Shard.create(config.meta, null);
    for (const shardId in config.shards) {
      this._shards[shardId] = await Shard.create(
        config.shards[shardId],
        shardId
      );
    }
    const { cache = DEFAULT_CACHE_CONFIG } = config;
    switch (cache.type) {
      case 'simple':
        this._cache = new SimpleCacheAdapter();
        break;
      case 'memcached':
        const backends = cache.backends || [];
        this._cache = new MemcachedCacheAdapter(backends, cache.options);
        break;
      default:
        throw new Error(`Invalid cache type "${cache.type}"`);
    }
    await this._cache.init();
    this.initialized = true;
  }

  get cache() {
    return this._cache;
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

  async close() {
    const promises = [this.meta().close()];
    for (const shardId in this.shards()) {
      promises.push(this.getShard(shardId).close());
    }
    return await Promise.all(promises);
  }
}

export const db = new DB();
