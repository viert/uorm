import ShardedModel from './sharded_model';
import AbstractModel from './abstract_model';
import { Constructor } from './util';
import { Field } from './decorators';
import {
  WrongSubmodel,
  SubmodelError,
  MissingSubmodel,
  UnknownSubmodel,
} from './errors';

export default class ShardedSubmodel extends ShardedModel {
  @Field() submodel: string;

  static __submodel__: string | null = null;
  static __submodel_loaders: {
    [key: string]: Constructor<ShardedSubmodel>;
  } = {};

  __submodel__(): string {
    const submodel = (this.constructor as typeof ShardedSubmodel).__submodel__;
    if (submodel === null) {
      throw new SubmodelError('submodel is not defined, this might be a bug');
    }
    return submodel;
  }

  constructor(shardId: string, data: { [key: string]: any } = {}) {
    super(shardId, data);
    if (this.isNew()) {
      if (!this.__submodel__) {
        throw new SubmodelError(
          `Attempted to create an object of abstract model ${this.constructor.name}`
        );
      }
      if ('submodel' in data) {
        throw new SubmodelError(
          'Attempt to override submodel for a new object'
        );
      }
      this.submodel = this.__submodel__();
    } else {
      if (!this.submodel) {
        throw new MissingSubmodel(
          `${this.constructor.name} has no submodel in DB. Bug?`
        );
      }
      this._checkSubmodel();
    }
  }

  _checkSubmodel() {
    if (this.submodel !== this.__submodel__()) {
      throw new WrongSubmodel(
        `Attempted to load ${this.submodel} as ${this.constructor.name}. Correct submodel would be ${this.__submodel__}. Bug?`
      );
    }
  }

  _validate(): void {
    super._validate();
    this._checkSubmodel();
  }

  protected static _preprocessQuery(query: {
    [key: string]: any;
  }): { [key: string]: any } {
    if (!this.__submodel__) return query;
    return {
      ...query,
      submodel: this.__submodel__,
    };
  }

  static registerSubmodel<T extends ShardedSubmodel>(
    name: string,
    ctor: Constructor<T>
  ) {
    if (this.__submodel__) {
      throw new SubmodelError(
        'Attempted to register a submodel with another submodel'
      );
    }
    if (name in this.__submodel_loaders) {
      throw new SubmodelError(`Submodel ${name} is already registered`);
    }
    this.__submodel_loaders[name] = ctor;
  }

  static fromData<T extends AbstractModel>(data: { [key: string]: any }): T {
    if (!('submodel' in data)) {
      throw new MissingSubmodel(`${this.name} has no submodel in the DB. Bug?`);
    }
    const submodelName = data['submodel'];
    if (!(submodelName in this.__submodel_loaders)) {
      throw new UnknownSubmodel(
        `Submodel ${submodelName} is not registered with ${this.name}`
      );
    }
    const ctor = this.__submodel_loaders[submodelName];
    return (new ctor(data) as unknown) as T;
  }
}
