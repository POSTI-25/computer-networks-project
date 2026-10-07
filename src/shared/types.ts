export interface TelemetryPayload {
  temperatureC: number;
  batteryMv: number;
  altitudeM: number;
  uptimeSeconds: number;
}

export interface FrameHeader {
  sequence: number;
  payloadLength: number;
  flags: number;
}

export interface FrameInput {
  sequence: number;
  payload: Buffer;
  flags?: number;
}

export interface FrameValidation {
  storedCrc: number;
  calculatedCrc: number;
  crcValid: boolean;
  formatValid: boolean;
}

export interface DecodedFrame extends FrameHeader, FrameValidation {
  // Owned copy of meaningful bytes only; empty when the declared length is invalid.
  payload: Buffer;
  telemetry?: TelemetryPayload;
}
