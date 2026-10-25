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

export interface TraceMessage {
  type: 'receiver.trace';
  timestamp: string;
  datagram: { index: number; bytes: number; hex: string; bits: string };
  bufferedBefore: number;
  bufferedAfter: number;
  transitions: import('../receiver/synchronizer.js').SyncTransition[];
}

export interface LessonRecording {
  type: 'lesson.recording';
  mode: string;
  steps: { trace: TraceMessage; metrics: ReceiverMetrics; frames: ValidFrameMessage[] }[];
}

export type ReceiverMessage = StatusMessage | ValidFrameMessage | TraceMessage | LessonRecording;
