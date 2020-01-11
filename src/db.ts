import { MongoClient, Db } from 'mongodb';
import AbstractModel from './abstract_model';

interface DBConfig {
  uri: string;
  options?: Object;
  dbname: string;
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
    let coll = this.db.collection(collection);
    let result = await coll.findOne(query);
    return new ModelClass(result);
  }
}

export { DBShard };
