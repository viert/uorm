import StorableModel from './storable_model';
import AbstractModel, { Field } from './abstract_model';
import {
  WrongSubmodel,
  SubmodelError,
  MissingSubmodel,
  UnknownSubmodel,
} from './errors';

type StorableSubmodelConstructor<T extends StorableSubmodel> = new (
  ...args: any[]
) => T;

export default class StorableSubmodel extends StorableModel {
  @Field() submodel: string;

  static __submodel__: string | null = null;
  static __submodel_loaders: {
    [key: string]: StorableSubmodelConstructor<StorableSubmodel>;
  } = {};

  get __submodel__() {
    return (this.constructor as typeof StorableSubmodel).__submodel__;
  }

  constructor(data: { [key: string]: any } = {}) {
    super(data);
    if (this.isNew) {
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
      this.submodel = this.__submodel__;
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
    if (this.submodel !== this.__submodel__) {
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

  static registerSubmodel<T extends StorableSubmodel>(
    name: string,
    ctor: StorableSubmodelConstructor<T>
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
