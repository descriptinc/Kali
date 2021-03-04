/* Time stretching and pitch shifting in javascript
 * Copyright (c) 2015 Vivek Panyam
 *
 * Based on tempo.c from SoX (copyright 2007 robs@users.sourceforge.net)
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

import TypedQueue from './TypedQueue';
import { Size, Double, Float, Int } from './Types';

// The c code used implicit conversion between floats and ints.
// Since JS stores everything as floats, we need to manually truncate when we
// set a float to an int. A good way to find all these spots is to use the
// `-Wconversion` flag when compiling the c code.
function handleInt(i: Int) {
  return Math.floor(i);
}

// NOTE: JS numbers can't handle 64 bit unsigned ints (without BigInteger or something)
// This is mostly used for sample counters, so it probably doesn't need a 64 bit uint
type UInt64 = number;

class Tempo {
  public isInitialized: boolean = false;
  public sampleRate: Size = 44100;
  public channels: Size = 0;
  public quickSearch: boolean = false;
  public factor: Double = 0;
  public search: Size = 0;
  public segment: Size = 0;
  public overlap: Size = 0;

  public processSize: Size = 0;

  /* Buffers */
  public overlapBuf: Float32Array | undefined; // float pointer

  /* Counters */
  public samplesIn: UInt64 = 0;
  public samplesOut: UInt64 = 0;
  public segmentsTotal: UInt64 = 0;

  constructor(
    public inputFifo: TypedQueue<Float32Array>,
    public outputFifo: TypedQueue<Float32Array>,
  ) {}
}

class Kali {
  private readonly t: Tempo;

  /* Waveform Similarity by least squares; works across multi-channels */

  // TODO: Optimize by caching?
  private static difference(
    a: Float32Array,
    b: Float32Array,
    length: Size,
  ): Float {
    let diff: Float = 0;
    for (let i = 0; i < length; i++) {
      diff += Math.pow(a[i] - b[i], 2);
    }

    return diff;
  }

  /* Find where the two segments are most alike over the overlap period. */
  private static tempoBestOverlapPosition(
    t: Tempo,
    newWin: Float32Array,
  ): Size {
    const f = t.overlapBuf;
    if (!f) {
      throw new Error('tempo_t not initialized');
    }

    let j: Size;
    let bestPos: Size;

    // NOTE: changed to zero-fill shift
    let prevBestPos: Size = (t.search + 1) >>> 1;
    let step: Size = 64;
    let i: Size = (bestPos = t.quickSearch ? prevBestPos : 0);

    let diff: Float;
    let leastDiff: Float = Kali.difference(
      newWin.subarray(t.channels * i),
      f,
      t.channels * t.overlap,
    );
    let k: Int = 0;

    // TODO: implement new quickseek algorithm from SoundTouch
    if (t.quickSearch) {
      do {
        // hierarchial search
        for (k = -1; k <= 1; k += 2) {
          for (j = 1; j < 4 || step == 64; j++) {
            i = prevBestPos + k * j * step;
            if (i < 0 || i >= t.search) {
              break;
            }

            diff = Kali.difference(
              newWin.subarray(t.channels * i),
              f,
              t.channels * t.overlap,
            );
            if (diff < leastDiff) {
              leastDiff = diff;
              bestPos = i;
            }
          }
        }

        prevBestPos = bestPos;
      } while ((step >>>= 2)); // NOTE: changed to zero-fill shift
    } else {
      for (i = 1; i < t.search; i++) {
        // linear search
        diff = Kali.difference(
          newWin.subarray(t.channels * i),
          f,
          t.channels * t.overlap,
        );
        if (diff < leastDiff) {
          leastDiff = diff;
          bestPos = i;
        }
      }
    }

    return bestPos;
  }

  private static tempoOverlap(
    t: Tempo,
    in1: Float32Array,
    in2: Float32Array,
    output: Float32Array,
  ): void {
    let k: Size = 0;
    const fadeStep: Float = 1.0 / t.overlap;

    for (let i = 0; i < t.overlap; i++) {
      const fadeIn: Float = fadeStep * i;
      const fadeOut: Float = 1.0 - fadeIn;
      for (let j = 0; j < t.channels; j++, k++) {
        output[k] = in1[k] * fadeOut + in2[k] * fadeIn;
      }
    }
  }

  public process(): void {
    const t = this.t;
    while (t.inputFifo.occupancy() >= t.processSize) {
      let offset: Size;

      /* Copy or overlap the first bit to the output */
      if (!t.segmentsTotal) {
        offset = t.search / 2;
        t.outputFifo.write(
          t.inputFifo.readPtr(t.channels * offset, t.overlap),
          t.overlap,
        );
      } else {
        offset = Kali.tempoBestOverlapPosition(t, t.inputFifo.readPtr(0));
        if (!t.overlapBuf) {
          throw new Error('t not initialized');
        }
        Kali.tempoOverlap(
          t,
          t.overlapBuf,
          t.inputFifo.readPtr(t.channels * offset),
          t.outputFifo.writePtr(t.overlap),
        );
      }

      /* Copy the middle bit to the output */
      t.outputFifo.write(
        t.inputFifo.readPtr(t.channels * (offset + t.overlap)),
        t.segment - 2 * t.overlap,
      );

      /* Copy the end bit to overlap_buf ready to be mixed with
       * the beginning of the next segment. */
      const numToCopy = t.channels * t.overlap;
      if (!t.overlapBuf) {
        throw new Error('t not initialized');
      }
      t.overlapBuf.set(
        t.inputFifo
          .readPtr(t.channels * (offset + t.segment - t.overlap))
          .subarray(0, numToCopy),
      );

      /* Advance through the input stream */
      t.segmentsTotal++;
      const skip = handleInt(t.factor * (t.segment - t.overlap) + 0.5);
      t.inputFifo.read(null, skip);
    }
  }

  public input(samples: Float32Array, n: Size | null = null): void {
    if (n == null) {
      n = samples.length;
    }

    const t = this.t;
    t.samplesIn += n;
    t.inputFifo.write(samples, n);
  }

  public output(samples: Float32Array): Size {
    const t = this.t;
    const n = Math.min(samples.length, t.outputFifo.occupancy());
    t.samplesOut += n;
    t.outputFifo.read(samples, n);
    return n;
  }

  public flush(): void {
    const t = this.t;
    const samplesOut: UInt64 = handleInt(t.samplesIn / t.factor + 0.5);
    const remaining: Size =
      samplesOut > t.samplesOut ? samplesOut - t.samplesOut : 0;
    const buff: Float32Array = new Float32Array(128 * t.channels);

    if (remaining > 0) {
      while (t.outputFifo.occupancy() < remaining) {
        this.input(buff, 128);
        this.process();
      }
      // TODO: trim buffer here
      // Otherwise potential bug if we reuse after a flush
      t.samplesIn = 0;
    }
  }

  static segmentsMs: Double[] = [82, 82, 35, 20];
  static segmentsPow: Double[] = [0, 1, 0.33, 1];
  static overlapsDiv: Double[] = [6.833, 7, 2.5, 2];
  static searchesDiv: Double[] = [5.587, 6, 2.14, 2];

  public reset() {
    const t = this.t;
    t.inputFifo.clear();
    t.outputFifo.clear();
    t.segmentsTotal = 0;
    t.samplesIn = 0;
    t.samplesOut = 0;
    if (t.overlapBuf) {
      t.overlapBuf.fill(0);
    }
  }

  public setup(
    sampleRate: Double,
    factor: Double, // Factor to change tempo by
    quickSearch: boolean = false,
    segmentMs: Double | null = null,
    searchMs: Double | null = null,
    overlapMs: Double | null = null,
  ): void {
    const profile = 1;
    this.reset();
    const t = this.t;
    t.sampleRate = sampleRate;

    if (segmentMs == null) {
      segmentMs = Math.max(
        10,
        Kali.segmentsMs[profile] /
          Math.max(Math.pow(factor, Kali.segmentsPow[profile]), 1),
      );
    }

    if (searchMs == null) {
      searchMs = segmentMs / Kali.searchesDiv[profile];
    }

    if (overlapMs == null) {
      overlapMs = segmentMs / Kali.overlapsDiv[profile];
    }

    t.quickSearch = quickSearch;
    t.factor = factor;
    t.segment = handleInt((sampleRate * segmentMs) / 1000 + 0.5);
    t.search = handleInt((sampleRate * searchMs) / 1000 + 0.5);
    t.overlap = Math.max(handleInt((sampleRate * overlapMs) / 1000 + 4.5), 16);
    if (t.overlap * 2 > t.segment) {
      t.overlap -= 8;
    }

    if (!t.isInitialized) {
      t.overlapBuf = new Float32Array(t.overlap * t.channels);
    } else {
      const newOverlap = new Float32Array(t.overlap * t.channels);
      let start = 0;
      if (!t.overlapBuf) {
        throw new Error('t not initialized');
      }
      if (t.overlap * t.channels < t.overlapBuf.length) {
        start = t.overlapBuf.length - t.overlap * t.channels;
      }

      newOverlap.set(t.overlapBuf.subarray(start, t.overlapBuf.length));
      t.overlapBuf = newOverlap;
    }

    const maxSkip = handleInt(Math.ceil(factor * (t.segment - t.overlap)));
    t.processSize = Math.max(maxSkip + t.overlap, t.segment) + t.search;
    t.inputFifo.reserve(handleInt(t.search / 2));
    t.isInitialized = true;
  }

  public setTempo(factor: Double) {
    const t = this.t;
    this.setup(t.sampleRate, factor, t.quickSearch);
  }

  constructor(channels: Size) {
    const t: Tempo = new Tempo(
      new TypedQueue(Float32Array),
      new TypedQueue(Float32Array),
    );
    t.channels = channels;
    this.t = t;
  }
}

export default Kali;
