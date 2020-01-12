import { StorableModel, Field, db } from '../src';

class User extends StorableModel {
  @Field({ required: true }) username: string;
  @Field() first_name: string;
  @Field() last_name: string;
  protected static _coll: string = 'user';
}

describe('storable model', () => {
  beforeAll(async done => {
    await db.init({
      meta: {
        uri: 'mongodb://localhost',
        dbname: 'exya_dev_meta',
        options: { useUnifiedTopology: true },
      },
      shards: {},
    });
    done();
  });
  it('compiles', async () => {
    const u = await User.findOne({ username: 'aquavitale' });
    console.log(u.toString());
  });
});
