import type { Scenario } from '../harness';

/**
 * Fixture setup for the shared-device + combined-condition scenarios.
 *
 * These fixtures describe the realistic field environment the app must
 * survive: a shared device handed off between workers, a battery that
 * drops while evidence is in flight, and a network that degrades mid-upload.
 */

export interface FixtureEvidence {
  id: string;
  sizeBytes: number;
}

export interface SharedDeviceLowBatteryFixture {
  name: string;
  description: string;
  sharedDeviceLowBatteryFixture: true;
  batteryLevel: number;
  charging: boolean;
  sharedDevice: boolean;
  evidence: FixtureEvidence[];
  scenarios: Scenario[];
}

export const sharedDeviceLowBatteryFixture: SharedDeviceLowBatteryFixture = {
  name: 'shared-device-low-battery',
  description:
    'Shared field device with low battery and a degraded network while evidence is mid-upload.',
  sharedDeviceLowBatteryFixture: true,
  batteryLevel: 12,
  charging: false,
  sharedDevice: true,
  evidence: [
    { id: 'ev-1', sizeBytes: 48_000 },
    { id: 'ev-2', sizeBytes: 120_000 },
  ],
  scenarios: [
    {
      name: 'low-battery-defers-sync-while-evidence-in-flight',
      description:
        'Low battery defers sync while an evidence upload is mid-flight and the network degrades.',
      steps: [
        { type: 'setBattery', level: 12, charging: false },
        { type: 'setNetwork', quality: 'degraded' },
        { type: 'startEvidenceUpload', id: 'ev-1', sizeBytes: 48_000 },
        { type: 'triggerSync' },
        { type: 'failEvidenceUpload', id: 'ev-1' },
        { type: 'wait', ms: 500 },
        { type: 'setBattery', level: 80, charging: true },
        { type: 'setNetwork', quality: 'online' },
        { type: 'flushBackgroundTasks' },
      ],
      assert: (state) => {
        const evidence = state.evidence.find((item) => item.id === 'ev-1');
        if (!evidence) {
          throw new Error('Evidence ev-1 was lost during the deferral');
        }
        if (evidence.status !== 'uploaded') {
          throw new Error(`Expected ev-1 to eventually upload, got ${evidence.status}`);
        }
        const queueItem = state.queue.find((item) => item.id === 'evidence-ev-1');
        if (!queueItem || queueItem.status !== 'done') {
          throw new Error('Evidence queue item for ev-1 did not settle');
        }
        if (state.queue.some((item) => item.status === 'in-flight')) {
          throw new Error('Queue still has in-flight items after flush');
        }
      },
    },
    {
      name: 'shared-device-clear-during-background-upload',
      description:
        'A shared-device session clear fires while an evidence upload is mid-flight and the network is degraded.',
      steps: [
        { type: 'enableSharedDevice' },
        { type: 'setNetwork', quality: 'degraded' },
        { type: 'startEvidenceUpload', id: 'ev-2', sizeBytes: 120_000 },
        { type: 'triggerSync' },
        { type: 'clearSharedDeviceSession' },
        { type: 'wait', ms: 250 },
        { type: 'setNetwork', quality: 'online' },
        { type: 'flushBackgroundTasks' },
      ],
      assert: (state) => {
        if (state.sessionActive) {
          throw new Error('Shared-device clear did not end the session');
        }
        const evidence = state.evidence.find((item) => item.id === 'ev-2');
        if (!evidence) {
          throw new Error('Evidence ev-2 was orphaned by the shared-device clear');
        }
        if (evidence.status !== 'uploaded') {
          throw new Error(`Expected ev-2 to be requeued and uploaded, got ${evidence.status}`);
        }
        if (state.queue.some((item) => item.status === 'in-flight')) {
          throw new Error('Queue still has in-flight items after shared-device clear');
        }
      },
    },
  ],
};

export default sharedDeviceLowBatteryFixture;
