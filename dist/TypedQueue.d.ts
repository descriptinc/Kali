import { Int, Size } from './Types';
declare type TypedArray =
  | Int8Array
  | Uint8Array
  | Int16Array
  | Uint16Array
  | Int32Array
  | Uint32Array
  | Uint8ClampedArray
  | Float32Array
  | Float64Array;
interface TypedArrayConstructor<T> {
  new (size: Int): T;
}
declare class TypedQueue<T extends TypedArray> {
  private buffer;
  private readonly typedArrayConstructor;
  private begin;
  private end;
  constructor(c: TypedArrayConstructor<T>);
  clear(): void;
  reserve(n: Int): Int;
  write(data: T, n: Int): void;
  writePtr(n: Int): T;
  read(data: T | null, n: Int): void;
  readPtr(start: Int, end?: Int): T;
  occupancy(): Size;
}
export default TypedQueue;
