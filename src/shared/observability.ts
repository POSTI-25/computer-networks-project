// JSON contract only: no receiver runtime dependencies in the browser.
export interface ReceiverMetrics {
  state: 'HUNT' | 'LOCK' | 'VERIFY' | 'EXTRACT';
  synced: boolean;
  udpDatagramsReceived: number;
  udpBytesReceived: number;
  asmDetections: number;
  validFrames: number;
  crcFailures: number;
  formatFailures: number;
  sequenceGaps: number;
  resyncCount: number;
  framesPerSecond: number;
  bytesPerSecond: number;
  bufferedBits: number;
  currentBitAlignment: number | null;
}

export interface StatusMessage {
  type: 'receiver.status';
  timestamp: string;
  metrics: ReceiverMetrics;
}

export interface ValidFrameMessage {
  type: 'frame.valid';
  timestamp: string;
  frame: {
    sequence: number;
    payloadLength: number;
    // Null only when a structurally valid payload lacks the 12 telemetry bytes.
    temperatureC: number | null;
    batteryMv: number | null;
    altitudeM: number | null;
    uptimeSeconds: number | null;
    bitAlignment: number;
  };
}

export type ReceiverMessage = StatusMessage | ValidFrameMessage;
