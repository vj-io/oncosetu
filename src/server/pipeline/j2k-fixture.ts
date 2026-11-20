// A 48 x 48, 16-bit, lossless JPEG 2000 codestream of a synthetic gradient, made with Pillow's OpenJPEG (a different encoder from
// the decoder under test). Pixel (x, y) = (x * 40 + y * 25) % 4000. Synthetic: not a scan.
export const J2K_GRADIENT_B64 =
  '/0//UQApAAAAAAAwAAAAMAAAAAAAAAAAAAAAMAAAADAAAAAAAAAAAAABDwEB/1IADAAAAAEABQQEAAH/XAATQICIiJCIiJCIiJCIiJCIiJD/ZAAlAAFDcmVhdGVkIGJ5IE9wZW5KUEVHIHZlcnNpb24gMi41LjT/kAAKAAAAAACOAAH/k9/4kFAHgVdZEypIuwCnwAPqA4AD5wYJCX8IUV/AH5g0APwBQBWSzdr/fwy709AkwA/AIgA+0IAsX9Byts//fzZJzHfFtG6/wAfaFwAPqCRLJfXx91IAMUu+RYQgKo1adGEhH8AD6guAA+cUgt3ptXOukADCQl/KnEqiM/HFwAwj/9k='
export const j2kGradient = (x: number, y: number) => (x * 40 + y * 25) % 4000
