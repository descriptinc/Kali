/* FIFO Queue
 * Copyright (c) 2015 Vivek Panyam
 *
 * Based on fifo.h from SoX (copyright 2007 robs@users.sourceforge.net)
 *
 * This library is free software; you can redistribute it and/or modify it
 * under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation; either version 2.1 of the License, or (at
 * your option) any later version.
 *
 * This library is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU Lesser
 * General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this library; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301  USA
 */

// Usage: var queue : TypedQueue<Float32Array> = new TypedQueue(Float32Array);
// There might be a cleaner way to do this; pull requests are welcome!

import { Int, Size } from './Types';

type TypedArray =
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

// Queue using typed arrays
class TypedQueue<T extends TypedArray> {
  private buffer: T;
  private readonly typedArrayConstructor: TypedArrayConstructor<T>;

  private begin: Int = 0; // index of first item in mem
  private end: Int = 0; // 1 + index of last item in mem

  constructor(c: TypedArrayConstructor<T>) {
    this.typedArrayConstructor = c;
    this.buffer = new c(16384);
  }

  public clear() {
    this.begin = this.end = 0;
  }

  public reserve(n: Int): Int {
    // returns index to start writing
    if (this.begin == this.end) {
      this.clear();
    }

    while (true) {
      // If we can fit the additional data, do it
      if (this.end + n < this.buffer.length) {
        const idx = this.end;
        this.end += n;
        return idx;
      }

      // Shift to beginning of array
      if (this.begin > 16384) {
        this.buffer.set(this.buffer.subarray(this.begin, this.end));
        this.end -= this.begin;
        this.begin = 0;
        continue;
      }

      // Resize array if nothing else works
      const newbuf = new this.typedArrayConstructor(this.buffer.length + n);
      newbuf.set(this.buffer);
      this.buffer = newbuf;
    }
  }

  public write(data: T, n: Int): void {
    const offset = this.reserve(n);
    this.buffer.set(data.subarray(0, n), offset);
  }

  public writePtr(n: Int): T {
    const offset = this.reserve(n);
    return this.buffer.subarray(offset, offset + n) as T;
  }

  public read(data: T | null, n: Int): void {
    if (n + this.begin > this.end) {
      console.error('Read out of bounds', n, this.end, this.begin);
    }

    if (data != null) {
      data.set(this.buffer.subarray(this.begin, this.begin + n));
    }

    this.begin += n;
  }

  public readPtr(start: Int, end: Int = -1): T {
    if (end > this.occupancy()) {
      console.error('Read Pointer out of bounds', end);
    }

    if (end < 0) {
      end = this.occupancy();
    }

    return this.buffer.subarray(this.begin + start, this.begin + end) as T;
  }

  public occupancy(): Size {
    return this.end - this.begin;
  }
}

export default TypedQueue;
