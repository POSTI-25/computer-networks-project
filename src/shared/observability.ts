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
    temperatureC: number;
    batteryMv: number;
    altitudeM: number;
    uptimeSeconds: number;
    bitAlignment: number;
  };
}

export type ReceiverMessage = StatusMessage | ValidFrameMessage;
