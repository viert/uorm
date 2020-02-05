import { db } from '../src';

function randomString() {
  return (
    Math.random()
      .toString(36)
      .substr(2, 15) +
    Math.random()
      .toString(36)
      .substr(2, 15)
  );
}

export async function initDatabases() {
  const uri = 'mongodb://localhost';
  const options = { useUnifiedTopology: true };
  await db.init({
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
      ro: {
        uri,
        options,
        dbname: randomString(),
        open: false,
      },
    },
  });
}
