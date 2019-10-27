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
// Queue using typed arrays
class TypedQueue {
  constructor(c) {
    this.begin = 0; // index of first item in mem
    this.end = 0; // 1 + index of last item in mem
    this.typedArrayConstructor = c;
    this.buffer = new c(16384);
  }
  clear() {
    this.begin = this.end = 0;
  }
  reserve(n) {
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
  write(data, n) {
    const offset = this.reserve(n);
    this.buffer.set(data.subarray(0, n), offset);
  }
  writePtr(n) {
    const offset = this.reserve(n);
    return this.buffer.subarray(offset, offset + n);
  }
  read(data, n) {
    if (n + this.begin > this.end) {
      console.error('Read out of bounds', n, this.end, this.begin);
    }
    if (data != null) {
      data.set(this.buffer.subarray(this.begin, this.begin + n));
    }
    this.begin += n;
  }
  readPtr(start, end = -1) {
    if (end > this.occupancy()) {
      console.error('Read Pointer out of bounds', end);
    }
    if (end < 0) {
      end = this.occupancy();
    }
    return this.buffer.subarray(this.begin + start, this.begin + end);
  }
  occupancy() {
    return this.end - this.begin;
  }
}

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
// The c code used implicit conversion between floats and ints.
// Since JS stores everything as floats, we need to manually truncate when we
// set a float to an int. A good way to find all these spots is to use the
// `-Wconversion` flag when compiling the c code.
function handleInt(i) {
  return Math.floor(i);
}
class Tempo {
  constructor(inputFifo, outputFifo) {
    this.inputFifo = inputFifo;
    this.outputFifo = outputFifo;
    this.isInitialized = false;
    this.sampleRate = 44100;
    this.channels = 0;
    this.quickSearch = false;
    this.factor = 0;
    this.search = 0;
    this.segment = 0;
    this.overlap = 0;
    this.processSize = 0;
    /* Counters */
    this.samplesIn = 0;
    this.samplesOut = 0;
    this.segmentsTotal = 0;
  }
}
class Kali {
  constructor(channels) {
    const t = new Tempo(
      new TypedQueue(Float32Array),
      new TypedQueue(Float32Array),
    );
    t.channels = channels;
    this.t = t;
  }
  /* Waveform Similarity by least squares; works across multi-channels */
  // TODO: Optimize by caching?
  static difference(a, b, length) {
    let diff = 0;
    for (let i = 0; i < length; i++) {
      diff += Math.pow(a[i] - b[i], 2);
    }
    return diff;
  }
  /* Find where the two segments are most alike over the overlap period. */
  static tempoBestOverlapPosition(t, newWin) {
    const f = t.overlapBuf;
    if (!f) {
      throw new Error('tempo_t not initialized');
    }
    let j;
    let bestPos;
    // NOTE: changed to zero-fill shift
    let prevBestPos = (t.search + 1) >>> 1;
    let step = 64;
    let i = (bestPos = t.quickSearch ? prevBestPos : 0);
    let diff;
    let leastDiff = Kali.difference(
      newWin.subarray(t.channels * i),
      f,
      t.channels * t.overlap,
    );
    let k = 0;
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
  static tempoOverlap(t, in1, in2, output) {
    let k = 0;
    const fadeStep = 1.0 / t.overlap;
    for (let i = 0; i < t.overlap; i++) {
      const fadeIn = fadeStep * i;
      const fadeOut = 1.0 - fadeIn;
      for (let j = 0; j < t.channels; j++, k++) {
        output[k] = in1[k] * fadeOut + in2[k] * fadeIn;
      }
    }
  }
  process() {
    const t = this.t;
    while (t.inputFifo.occupancy() >= t.processSize) {
      let offset;
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
  input(samples, n = null) {
    if (n == null) {
      n = samples.length;
    }
    const t = this.t;
    t.samplesIn += n;
    t.inputFifo.write(samples, n);
  }
  output(samples) {
    const t = this.t;
    const n = Math.min(samples.length, t.outputFifo.occupancy());
    t.samplesOut += n;
    t.outputFifo.read(samples, n);
    return n;
  }
  flush() {
    const t = this.t;
    const samplesOut = handleInt(t.samplesIn / t.factor + 0.5);
    const remaining = samplesOut > t.samplesOut ? samplesOut - t.samplesOut : 0;
    const buff = new Float32Array(128 * t.channels);
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
  setup(
    sampleRate,
    factor, // Factor to change tempo by
    quickSearch = false,
    segmentMs = null,
    searchMs = null,
    overlapMs = null,
  ) {
    const profile = 1;
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
    if (!t.isInitialized) {
      t.inputFifo.reserve(handleInt(t.search / 2));
    }
    t.isInitialized = true;
  }
  setTempo(factor) {
    const t = this.t;
    this.setup(t.sampleRate, factor, t.quickSearch);
  }
}
Kali.segmentsMs = [82, 82, 35, 20];
Kali.segmentsPow = [0, 1, 0.33, 1];
Kali.overlapsDiv = [6.833, 7, 2.5, 2];
Kali.searchesDiv = [5.587, 6, 2.14, 2];

export default Kali;
