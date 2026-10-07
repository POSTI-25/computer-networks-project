import { CRC_FINAL_XOR, CRC_INITIAL_VALUE, CRC_POLYNOMIAL } from './constants.js';

// Non-reflected CRC-16/CCITT: init FFFF, poly 1021, xorout 0000.
// Error detection only; shared by frame encoding and verification.
export function crc16Ccitt(data: Buffer): number {
  let crc = CRC_INITIAL_VALUE;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = ((crc & 0x8000) !== 0 ? (crc << 1) ^ CRC_POLYNOMIAL : crc << 1) & 0xffff;
    }
  }
  return (crc ^ CRC_FINAL_XOR) & 0xffff;
}
