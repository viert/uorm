import { initDatabases } from './util';
import { StorableSubmodel, Field, db } from '../src';
import { ObjectID } from 'bson';
import { WrongSubmodel, MissingSubmodel, SubmodelError } from '../src/errors';

class TestBaseSubmodel extends StorableSubmodel {
  @Field({ defaultValue: 1 }) field1: number;
  @Field({ defaultValue: 2 }) field2: number;
  static _collection = 'submodel1';
}

class Submodel1 extends TestBaseSubmodel {
  static __submodel__ = 'submodel1';
}

class Submodel2 extends TestBaseSubmodel {
  static __submodel__ = 'submodel2';
}

class Submodel1_1 extends Submodel1 {}

TestBaseSubmodel.registerSubmodel('submodel1', Submodel1);
TestBaseSubmodel.registerSubmodel('submodel2', Submodel2);

async function createObjects() {
  const values = [1, 2, 3];
  const objs1 = values.map(v => new Submodel1({ field1: v, field2: v }));
  const objs2 = values.map(v => new Submodel2({ field1: v, field2: v }));
  await Promise.all(objs1.concat(objs2).map(obj => obj.save()));
  return [objs1, objs2];
}

describe('storable submodel', () => {
  beforeAll(async done => {
    await initDatabases();
    done();
  });

  beforeEach(async done => {
    await TestBaseSubmodel.destroyAll();
    done();
  });

  afterAll(async done => {
    await db.meta().db.dropDatabase();
    for (const shardId in db.shards()) {
      await db.getShard(shardId).db.dropDatabase();
    }
    done();
  });

  it('wrong input', async () => {
    expect(() => {
      new Submodel1({
        _id: new ObjectID(),
        field1: 1,
        submodel: 'wrong',
      });
    }).toThrow(WrongSubmodel);

    expect(() => {
      new Submodel1({
        _id: new ObjectID(),
        field1: 1,
      });
    }).toThrow(MissingSubmodel);

    expect(() => {
      new Submodel1({
        field1: 1,
        submodel: 'my_submodel',
      });
    }).toThrow(SubmodelError);
  });

  it('has proper submodel field', async () => {
    const obj = new Submodel1();
    expect(obj.submodel).toBeTruthy();
    expect(obj.submodel).toEqual(Submodel1.__submodel__);
    await obj.save();
    await obj.reload();
    expect(obj.submodel).toEqual(Submodel1.__submodel__);
    const dbObj = await Submodel1.get(obj._id);
    if (dbObj === null) {
      fail();
    }
    expect(dbObj.submodel).toEqual(Submodel1.__submodel__);
  });

  it('follows inheritance', () => {
    expect(TestBaseSubmodel.__collection__).toEqual(Submodel1.__collection__);
    expect(Submodel1_1.__collection__).toEqual(Submodel1.__collection__);
    expect(Submodel1_1.__submodel__).toEqual(Submodel1.__submodel__);
  });

  it('abstract throws', () => {
    expect(() => {
      new TestBaseSubmodel();
    }).toThrow(SubmodelError);

    expect(() => {
      Submodel1.registerSubmodel('submodel1_1', Submodel1_1);
    }).toThrow(SubmodelError);
  });

  it('isolation find', async () => {
    const [objs1, objs2] = await createObjects();
    const objs1t = await Submodel1.find().toArray();
    expect(objs1.length).toEqual(objs1t.length);
    const objs2t = await Submodel2.find().toArray();
    expect(objs2.length).toEqual(objs2t.length);

    objs1t.forEach(obj => {
      expect(obj.submodel).toEqual(Submodel1.__submodel__);
    });
    objs2t.forEach(obj => {
      expect(obj.submodel).toEqual(Submodel2.__submodel__);
    });
    const objs3t = await TestBaseSubmodel.find().toArray();
    expect(objs3t.length).toEqual(objs1.length + objs2.length);
  });
});
