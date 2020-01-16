import { db } from '../src';
import { randomString } from './util';

// const DEFAULT_CALLABLE_VALUE: number = 4;

// function callable(): number {
//   return DEFAULT_CALLABLE_VALUE;
// }

// class TestModel extends ShardedModel {
//   @Field({ defaultValue: 'default_value', rejected: true }) field1: string;
//   @Field({ required: true }) field2: string;
//   @Field({ defaultValue: 'required_default_value', required: true })
//   field3: string;
//   @Field({ defaultValue: callable }) callable_default_field: number;
// }

describe('sharded model', () => {
  beforeAll(async done => {
    const uri = 'mongodb://localhost';
    const options = { useUnifiedTopology: true };
    db.init({
      meta: {
        uri,
        options,
        dbname: randomString(),
      },
      shards: {
        s1: {
          uri,
          options,
          dbname: randomString(),
        },
        s2: {
          uri,
          options,
          dbname: randomString(),
        },
        s3: {
          uri,
          options,
          dbname: randomString(),
        },
        s4: {
          uri,
          options,
          dbname: randomString(),
        },
      },
    });

    done();
  });

  it('compiles', () => {});
});
