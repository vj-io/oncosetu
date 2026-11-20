import { describe, expect, it } from 'vitest'
import { signV4 } from './objects'

describe('AWS Signature Version 4 (object storage requests)', () => {
  it('matches the GET Object example published in the Amazon S3 SigV4 documentation', () => {
    // Amazon S3 API reference, "Signature Calculations for the Authorization Header", example: GET Object with a Range header.
    const auth = signV4({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: {
        host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9',
        'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'x-amz-date': '20130524T000000Z',
      },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1', service: 's3', amzDate: '20130524T000000Z',
    })
    expect(auth).toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, '
      + 'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
  })

  it('matches the PUT Object example (a key with "$", a body, storage-class header)', () => {
    const body = 'Welcome to Amazon S3.'
    const payloadHash = '44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072'
    const auth = signV4({
      method: 'PUT',
      url: new URL('https://examplebucket.s3.amazonaws.com/test%24file.text'),
      headers: {
        host: 'examplebucket.s3.amazonaws.com', date: 'Fri, 24 May 2013 00:00:00 GMT', 'x-amz-date': '20130524T000000Z',
        'x-amz-storage-class': 'REDUCED_REDUNDANCY', 'x-amz-content-sha256': payloadHash,
      },
      payloadHash, accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1', service: 's3', amzDate: '20130524T000000Z',
    })
    expect(body.length).toBe(21)
    expect(auth.endsWith('Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd')).toBe(true)
  })
})
