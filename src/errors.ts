export class FieldRequired extends Error {
  name = 'FieldRequired';
  constructor(fieldName: string) {
    super(`Field "${fieldName}" can not be empty`);
  }
}

export class ModelSaveRequired extends Error {
  name = 'ModelSaveRequired';
  constructor() {
    super('This model must be saved first');
  }
}

export class InvalidShardId extends Error {
  name = 'InvalidShardId';
  constructor(shardId: string) {
    super(`Shard "${shardId}" doesn't exist`);
  }
}

export class ModelDestroyed extends Error {
  name = 'ModelDestroyed';
  constructor() {
    super('model has been deleted from db');
  }
}

export class MissingShardId extends Error {
  name = 'MissingShardId';
  constructor() {
    super('shard_id is missing from ShardedModel');
  }
}

export class WrongModelType extends Error {
  name = 'WrongModelType';
}

export class WrongSubmodel extends Error {
  name = 'WrongSubmodel';
}

export class SubmodelError extends Error {
  name = 'SubmodelError';
}

export class MissingSubmodel extends Error {
  name = 'MissingSubmodel';
}

export class UnknownSubmodel extends Error {
  name = 'UnknownSubmodel';
}

export class TypeError extends Error {
  name = 'TypeError';
}

export class ValidationError extends Error {
  name = 'ValidationError';
}
