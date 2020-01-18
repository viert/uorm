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
  console.log(user);
}

await User.destroyAll()
```
