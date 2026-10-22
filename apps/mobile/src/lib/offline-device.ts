import * as Device from 'expo-device';

// Six-GB devices may report less RAM after hardware reservations; inference checks free memory separately.
export const supportsLargeOfflineModels = () => Device.totalMemory !== null && Device.totalMemory >= 5 * 1024 ** 3;
export const largeModelMemoryReason = (name: string) => `${name} needs a phone with about 6 GB RAM. ${Device.totalMemory === null ? 'Device memory could not be checked.' : `This phone reports ${(Device.totalMemory / 1_000_000_000).toFixed(1)} GB.`}`;
