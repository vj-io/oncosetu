declare module 'heic-convert' {
  export default function convert(opts: { buffer: Uint8Array | Buffer; format: 'JPEG' | 'PNG'; quality?: number }): Promise<ArrayBuffer | Uint8Array>
}
