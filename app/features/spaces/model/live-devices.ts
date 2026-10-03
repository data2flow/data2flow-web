/**
 * 공간 보기 기기 카드의 실시간 갱신(API-DSH-20 `space:{id}` → `device-update`).
 */
export interface MetricValue {
  key: string;
  value: number | null;
  unit?: string | null;
  quality?: number | null;
  at?: string | null;
}

export interface OverviewDevice {
  id: string;
  name: string;
  modelId?: string | null;
  modelName?: string | null;
  status?: string;
  connection?: string | null;
  lastSeenAt?: string | null;
  battery?: number | null;
  rssi?: number | null;
  metrics?: MetricValue[];
}

export interface DeviceUpdate {
  deviceId: string | number;
  metrics?: MetricValue[];
  connection?: string;
  state?: string;
}

/** 받은 측정값을 해당 기기 카드에 덮어쓴다. 모르는 기기는 무시한다(권한 필터는 서버가 함) */
export function applyDeviceUpdate(devices: OverviewDevice[], update: DeviceUpdate): OverviewDevice[] {
  const id = String(update.deviceId);
  if (!devices.some((d) => d.id === id)) return devices;
  return devices.map((d) => {
    if (d.id !== id) return d;
    const merged = new Map((d.metrics ?? []).map((m) => [m.key, m]));
    let latest = d.lastSeenAt ?? null;
    for (const m of update.metrics ?? []) {
      merged.set(m.key, { ...merged.get(m.key), ...m });
      if (m.at && (!latest || Date.parse(m.at) > Date.parse(latest))) latest = m.at;
    }
    return { ...d, metrics: [...merged.values()], connection: update.connection ?? d.connection, status: update.state ?? d.status, lastSeenAt: latest };
  });
}
