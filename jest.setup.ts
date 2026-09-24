// jest-expo preset handles React Native transforms; nothing extra needed yet.
import { TextDecoder, TextEncoder } from 'util';

if (typeof global.TextEncoder === 'undefined') {
  (global as any).TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
  (global as any).TextDecoder = TextDecoder;
}

