# uORM

This is a port of python [uEngine](https://github.com/viert/uengine) MongoDB ORM library

## Usage

Declare models:

```typescript
import { StorableModel, Field } from 'uorm';

class User extends StorableModel {
  _collection = 'user';

  @Field({ required: true }) username: string;
  @Field() first_name: string;
  @Field() last_name: string;
  @Field({ defaultValue: Date }) created_at: Date;
  @Field() description: string;

  get fullname() {
    return `${this.first_name} ${this.last_name}`;
  }
}
```

Initialize database connections

```typescript
import { db, DBConfig } from 'uorm';

const conf: DBConfig = {
  meta: {
    uri: 'mongodb://localhost',
    dbname: 'mydb',
    options: { useUnifiedTopology: true },
  },
  shards: {},
};

async function main() {
  await db.init(conf);
}
```

Use models for CRUD operations:

```typescript
let user = await User.findOne({username: 'johndoe'})
console.log(user);
user.first_name = 'Jim'
await user.save();

const cursor = User.find({first_name: 'John'})
for await (user in cursor) {
  console.log(user); // Cursor emits User instances
}

await User.destroyAll()
```

## Async computed properties

Model's `toObject(fields: string[])` method automatically picks up any getter you have in your model:

```typescript
class MyModel extends StorableModel {
  @Field() field1: string;
  @Field() field2: string;
  @Field() field3: string;

  get concat() {
    return field1 + field2 + field3;
  }
}

const model = new MyModel({ field1: 'a', field2: 'b', field3: 'c' });
console.log(
  model.toObject(['field1', 'field2', 'field3', 'concat', 'non-existent'])
);
/**
{
  field1: 'a',
  field2: 'b',
  field3: 'c',
  concat: 'abc'
}
*/
```

However you might want to use other models in computations, i.e. you need to wait for the DB or for your cache adapter like Memcached or Redis or whatever. In this case getter will let you down, it's syncronous.

For your convenience there's an async method `async asyncObject(fields)` which handles this (remember that you have to `await` it). To expose your async computed property, use `AsyncComputed` decorator:

```typescript
class Token extends StorableModel {
  @Field({ required: true }) token: string;
  @Field({ required: true }) owner_id: ObjectID;

  @AsyncComputed()
  get owner() {
    const user = await User.findOne({ _id: this.owner_id });
    return await user.asyncObject();
  }
}
```
