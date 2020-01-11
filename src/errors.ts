export class InvalidFieldType extends Error {
  name = 'InvalidFieldType';
}

export class FieldRequired extends Error {
  name = 'FieldRequired';
  constructor(fieldName: string) {
    super(`Field ${fieldName} can not be empty`);
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
