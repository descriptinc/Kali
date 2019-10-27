import { Size, Double } from './Types';
declare class Kali {
  private readonly t;
  private static difference;
  private static tempoBestOverlapPosition;
  private static tempoOverlap;
  process(): void;
  input(samples: Float32Array, n?: Size | null): void;
  output(samples: Float32Array): Size;
  flush(): void;
  static segmentsMs: Double[];
  static segmentsPow: Double[];
  static overlapsDiv: Double[];
  static searchesDiv: Double[];
  setup(
    sampleRate: Double,
    factor: Double, // Factor to change tempo by
    quickSearch?: boolean,
    segmentMs?: Double | null,
    searchMs?: Double | null,
    overlapMs?: Double | null,
  ): void;
  setTempo(factor: Double): void;
  constructor(channels: Size);
}
export default Kali;
