import { encode, decode } from 'base64-url';

export function encodeState(data: object) {
  return encode(JSON.stringify(data));
}

export function decodeState(state: string) {
  return JSON.parse(decode(state));
}
