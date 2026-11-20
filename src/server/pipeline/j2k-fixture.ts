// A 48 x 48, 16-bit, lossless JPEG 2000 codestream of a synthetic gradient, made with Pillow's OpenJPEG (a different encoder from
// the decoder under test). Pixel (x, y) = (x * 40 + y * 25) % 4000. Synthetic: not a scan.
export const J2K_GRADIENT_B64 =
  '/0//UQApAAAAAAAwAAAAMAAAAAAAAAAAAAAAMAAAADAAAAAAAAAAAAABDwEB/1IADAAAAAEABQQEAAH/XAATQICIiJCIiJCIiJCIiJCIiJD/ZAAlAAFDcmVhdGVkIGJ5IE9wZW5KUEVHIHZlcnNpb24gMi41LjT/kAAKAAAAAACOAAH/k9/4kFAHgVdZEypIuwCnwAPqA4AD5wYJCX8IUV/AH5g0APwBQBWSzdr/fwy709AkwA/AIgA+0IAsX9Byts//fzZJzHfFtG6/wAfaFwAPqCRLJfXx91IAMUu+RYQgKo1adGEhH8AD6guAA+cUgt3ptXOukADCQl/KnEqiM/HFwAwj/9k='
export const j2kGradient = (x: number, y: number) => (x * 40 + y * 25) % 4000

// A 16 x 24 picture (16 columns, 24 rows; pixel (x, y) = x * 100 + y * 7) whose raster was handed to Pillow's OpenJPEG as if it
// were 24 wide and 16 tall, so the codestream says 24 x 16 while the DICOM header says 16 columns, 24 rows. A real patient's MRI CD
// (2026-11 local run) had every non-square slice on two of its five CDs written this way. Synthetic: not a scan.
export const J2K_SWAPPED_B64 =
  '/0//UQApAAAAAAAYAAAAEAAAAAAAAAAAAAAAGAAAABAAAAAAAAAAAAABDwEB/1IADAAAAAEABAQEAAH/XAAQQICIiJCIiJCIiJCIiJD/ZAAlAAFDcmVhdGVkIGJ5IE9wZW5KUEVHIHZlcnNpb24gMi41LjT/kAAKAAAAAADwAAH/k8/8MBgIXd74/3/AB9oFAB9oEAGHAd/AH5hMAD6gMAHEvJNSJu3I6Qs5L8AfmJQAHzhoAAEQF9WR6L4d+cVtFIoxLznrGQvPA4Hsgq4jJB/AH5isA/ZhgD9hICIYGWzuQ3RL0AA3GInGkPG+UvQaHxQATwSGG4hjXMeqhGlCdRjXMeqhGnmBKOwz8ToUuzQeUMUHjXC6yfZNgjRcnbmjyXWTkHDfR7YFZoPJviG1H8jpd0r9V9bC082UtjzFNdm0hmXH6RXlsKxDcN+KY8xjjuciGPkEIem/qgAAGEhGi9YMxt7/2Q=='
export const j2kSwapped = (x: number, y: number) => x * 100 + y * 7
