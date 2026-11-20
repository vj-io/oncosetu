// Type shims for the DICOM codec packages (they ship JavaScript only, or no types for the parts we use).
declare module '@cornerstonejs/codec-openjpeg/decodewasmjs' { const factory: (opts?: { wasmBinary?: Uint8Array }) => Promise<unknown>; export default factory }
declare module '@cornerstonejs/codec-charls/decodewasmjs' { const factory: (opts?: { wasmBinary?: Uint8Array }) => Promise<unknown>; export default factory }
declare module 'jpeg-lossless-decoder-js' {
  export class Decoder { decode(buffer?: ArrayBuffer, offset?: number, length?: number, numBytes?: number): Uint8Array | Uint16Array }
}
