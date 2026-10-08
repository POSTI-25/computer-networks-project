// PRD sections 8–9: custom educational frame; the CCSDS ASM is outside it.
export const ASM_VALUE = 0x1acffc1d;
export const ASM_SIZE_BYTES = 4;
export const ASM_SIZE_BITS = 32;

export const FRAME_SIZE_BYTES = 256;
export const FRAME_SIZE_BITS = 2048;
export const TRANSMISSION_UNIT_SIZE_BYTES = ASM_SIZE_BYTES + FRAME_SIZE_BYTES;
export const TRANSMISSION_UNIT_SIZE_BITS = ASM_SIZE_BITS + FRAME_SIZE_BITS;

export const SEQUENCE_OFFSET = 0;
export const SEQUENCE_SIZE = 4;
export const PAYLOAD_LENGTH_OFFSET = 4;
export const PAYLOAD_LENGTH_SIZE = 2;
export const FLAGS_OFFSET = 6;
export const FLAGS_SIZE = 2;
export const PAYLOAD_OFFSET = 8;
export const PAYLOAD_CAPACITY = 246;
export const CRC_OFFSET = 254;
export const CRC_SIZE = 2;
export const DEFAULT_PAYLOAD_LENGTH = 12;

export const TEMPERATURE_OFFSET = 0;
export const BATTERY_OFFSET = 2;
export const ALTITUDE_OFFSET = 4;
export const UPTIME_OFFSET = 8;

export const CRC_POLYNOMIAL = 0x1021;
export const CRC_INITIAL_VALUE = 0xffff;
export const CRC_FINAL_XOR = 0x0000;

// PRD sections 6, 10, 11, and 22: localhost clean-link defaults.
export const DEFAULT_UDP_HOST = '127.0.0.1';
export const DEFAULT_UDP_PORT = 5000;
export const DEFAULT_FRAME_RATE = 5;
export const DEFAULT_CHUNK_MIN_BYTES = 1;
export const DEFAULT_CHUNK_MAX_BYTES = 96;
export const DEFAULT_SIM_SEED = 42;
