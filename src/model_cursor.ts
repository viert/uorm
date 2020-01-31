import { CommonObject, Nullable } from './util';
import { BaseModel } from './model';
import { Cursor } from 'mongodb';

export class ModelCursor<T extends typeof BaseModel> {
  private mapper: (item: CommonObject) => InstanceType<T>;

  constructor(
    private _cursor: Cursor,
    private objCtor: T,
    private shardId: Nullable<string> = null
  ) {
    this.mapper = this.shardId
      ? (item: CommonObject) => {
          item['shard_id'] = this.shardId;
          return this.objCtor.make(item);
        }
      : (item: CommonObject) => this.objCtor.make(item);
  }

  rewind() {
    this._cursor.rewind();
    return this;
  }

  skip(value: number) {
    this._cursor.skip(value);
    return this;
  }

  sort(keyOrList: string | object | object[], direction?: number) {
    this._cursor.sort(keyOrList, direction);
    return this;
  }

  limit(value: number) {
    this._cursor.limit(value);
    return this;
  }

  async all() {
    const results = await this._cursor.toArray();
    return results.map(this.mapper);
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<InstanceType<T>> {
    for await (const item of this._cursor) {
      yield this.mapper(item);
    }
  }

  async forEach(callback: (obj: InstanceType<T>, index?: number) => void) {
    let index = 0;
    await this._cursor.forEach(item => {
      callback(this.mapper(item), index++);
    });
  }

  async hasNext() {
    return await this._cursor.hasNext();
  }

  async next(): Promise<Nullable<InstanceType<T>>> {
    const item = await this._cursor.next();
    if (!item) return null;
    return this.mapper(item);
  }

  async count() {
    return await this._cursor.count();
  }
}
