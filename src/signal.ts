import type { TunerState, Signal, WeatherOffset, WeatherConfig } from './types';

export type CheckSeverity = 'error' | 'warning' | 'info';

export interface SignalCheckResult {
  id: string;
  signalName?: string;
  severity: CheckSeverity;
  category: string;
  message: string;
}

export function validateSignals(signals: Signal[]): SignalCheckResult[] {
  const results: SignalCheckResult[] = [];
  const idCounts = new Map<string, number>();

  for (const signal of signals) {
    idCounts.set(signal.id, (idCounts.get(signal.id) || 0) + 1);
  }

  for (const [id, count] of idCounts) {
    if (count > 1) {
      results.push({
        id: id,
        severity: 'error',
        category: 'DUPLICATE_ID',
        message: `重复编号: ${id} 出现 ${count} 次`
      });
    }
  }

  for (const signal of signals) {
    const ranges: { name: string; range: [number, number] }[] = [
      { name: 'vhfRange', range: signal.vhfRange },
      { name: 'uhfRange', range: signal.uhfRange },
      { name: 'antennaAngle', range: signal.antennaAngle }
    ];

    for (const { name, range } of ranges) {
      if (range[0] > range[1]) {
        results.push({
          id: signal.id,
          signalName: signal.name,
          severity: 'error',
          category: 'RANGE_INVERTED',
          message: `[${signal.name}] ${name} 范围倒置: [${range[0]}, ${range[1]}]`
        });
      }
    }

    if (signal.intensity < 0 || signal.intensity > 1) {
      results.push({
        id: signal.id,
        signalName: signal.name,
        severity: 'error',
        category: 'INTENSITY_OUT_OF_BOUNDS',
        message: `[${signal.name}] 强度越界: ${signal.intensity} (应在 0-1 之间)`
      });
    }

    if (!signal.fragmentPath || !signal.fragmentPath.startsWith('#')) {
      results.push({
        id: signal.id,
        signalName: signal.name,
        severity: 'error',
        category: 'BINARY_INVALID',
        message: `[${signal.name}] 二进制片段格式异常: 缺少 # 前缀`
      });
    } else {
      const binaryPart = signal.fragmentPath.substring(1);
      if (binaryPart.length === 0) {
        results.push({
          id: signal.id,
          signalName: signal.name,
          severity: 'warning',
          category: 'BINARY_EMPTY',
          message: `[${signal.name}] 二进制片段为空`
        });
      } else if (!/^[01]+$/.test(binaryPart)) {
        results.push({
          id: signal.id,
          signalName: signal.name,
          severity: 'error',
          category: 'BINARY_INVALID',
          message: `[${signal.name}] 二进制片段包含非法字符: 仅允许 0 和 1`
        });
      }
    }

    if (!signal.description || signal.description.trim() === '') {
      results.push({
        id: signal.id,
        signalName: signal.name,
        severity: 'warning',
        category: 'MISSING_DESCRIPTION',
        message: `[${signal.name}] 缺失描述`
      });
    }
  }

  return results;
}

export function formatCheckResults(results: SignalCheckResult[]): string {
  if (results.length === 0) {
    return '[INFO] 体检完成: 所有频道数据正常 ✓';
  }

  const lines: string[] = [];
  const errorCount = results.filter(r => r.severity === 'error').length;
  const warningCount = results.filter(r => r.severity === 'warning').length;

  lines.push('╔══════════════════════════════════════════════════════════════╗');
  lines.push('║          CHANNEL ZERO - 频道数据体检报告                     ║');
  lines.push('╚══════════════════════════════════════════════════════════════╝');
  lines.push('');
  lines.push(`[SUMMARY] 共发现 ${errorCount} 个错误, ${warningCount} 个警告`);
  lines.push('');

  for (const result of results) {
    const tag = result.severity === 'error' ? 'ERROR' : result.severity === 'warning' ? 'WARN ' : 'INFO ';
    lines.push(`[${tag}] ${result.message}`);
  }

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');

  return lines.join('\n');
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function inverseLerp(min: number, max: number, value: number): number {
  if (max === min) return 0;
  return clamp((value - min) / (max - min), 0, 1);
}

export function centerOfRange(range: [number, number]): number {
  return (range[0] + range[1]) / 2;
}

export function calculateMatchStrength(
  value: number,
  range: [number, number],
  falloff: number = 15
): number {
  const center = centerOfRange(range);
  const halfWidth = (range[1] - range[0]) / 2;
  const distance = Math.abs(value - center);

  if (distance <= halfWidth) {
    const normalized = inverseLerp(halfWidth, 0, distance);
    return Math.pow(normalized, 0.5);
  } else {
    const outside = distance - halfWidth;
    return Math.max(0, Math.exp(-outside / falloff));
  }
}

export interface SignalMatch {
  signal: Signal | null;
  strength: number;
  vhfMatch: number;
  uhfMatch: number;
  antennaMatch: number;
}

export function findBestSignalMatch(
  tuner: TunerState,
  signals: Signal[],
  weatherOffset: WeatherOffset
): SignalMatch {
  let bestMatch: SignalMatch = {
    signal: null,
    strength: 0,
    vhfMatch: 0,
    uhfMatch: 0,
    antennaMatch: 0
  };

  for (const signal of signals) {
    let effectiveVhfRange: [number, number] = [...signal.vhfRange] as [number, number];
    let effectiveUhfRange: [number, number] = [...signal.uhfRange] as [number, number];
    let effectiveAntennaRange: [number, number] = [...signal.antennaAngle] as [number, number];

    if (signal.weatherAffected) {
      effectiveVhfRange = [
        effectiveVhfRange[0] + weatherOffset.vhfShift,
        effectiveVhfRange[1] + weatherOffset.vhfShift
      ];
      effectiveUhfRange = [
        effectiveUhfRange[0] + weatherOffset.uhfShift,
        effectiveUhfRange[1] + weatherOffset.uhfShift
      ];
      effectiveAntennaRange = [
        effectiveAntennaRange[0] + weatherOffset.antennaShift,
        effectiveAntennaRange[1] + weatherOffset.antennaShift
      ];
    }

    const vhfMatch = calculateMatchStrength(tuner.vhf, effectiveVhfRange, 12);
    const uhfMatch = calculateMatchStrength(tuner.uhf, effectiveUhfRange, 30);
    const antennaMatch = calculateMatchStrength(tuner.antenna, effectiveAntennaRange, 25);

    const combinedStrength = (vhfMatch * 0.35 + uhfMatch * 0.35 + antennaMatch * 0.3) * signal.intensity;

    if (combinedStrength > bestMatch.strength) {
      bestMatch = {
        signal,
        strength: combinedStrength,
        vhfMatch,
        uhfMatch,
        antennaMatch
      };
    }
  }

  return bestMatch;
}

export function getSignalColor(signal: Signal | null, strength: number): [number, number, number] {
  if (!signal || strength < 0.1) {
    return [0.08, 0.08, 0.1];
  }

  const hue = signal.id === 'signal_01' ? 0.0
    : signal.id === 'signal_02' ? 0.62
    : signal.id === 'signal_03' ? 0.33
    : 0.12;

  const sat = 0.7 * strength;
  const light = 0.35 * strength;

  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs((hue * 6) % 2 - 1));
  const m = light - c / 2;

  let r = 0, g = 0, b = 0;
  if (hue < 1/6) { r = c; g = x; }
  else if (hue < 2/6) { r = x; g = c; }
  else if (hue < 3/6) { g = c; b = x; }
  else if (hue < 4/6) { g = x; b = c; }
  else if (hue < 5/6) { r = x; b = c; }
  else { r = c; b = x; }

  return [r + m, g + m, b + m];
}

export class WeatherSystem {
  private config: WeatherConfig;
  private offset: WeatherOffset;
  private targetOffset: WeatherOffset;
  private lastUpdate: number;
  private stormPulse: number = 0;
  private flashActive: boolean = false;
  private flashTimer: number = 0;

  constructor(config: WeatherConfig) {
    this.config = config;
    this.offset = { vhfShift: 0, uhfShift: 0, antennaShift: 0 };
    this.targetOffset = { vhfShift: 0, uhfShift: 0, antennaShift: 0 };
    this.lastUpdate = Date.now();
    this.generateNewTarget();
  }

  private generateNewTarget(): void {
    const { vhfShift, uhfShift, antennaShift } = this.config.baseOffset;
    this.targetOffset = {
      vhfShift: vhfShift[0] + Math.random() * (vhfShift[1] - vhfShift[0]),
      uhfShift: uhfShift[0] + Math.random() * (uhfShift[1] - uhfShift[0]),
      antennaShift: antennaShift[0] + Math.random() * (antennaShift[1] - antennaShift[0])
    };
  }

  update(): { offset: WeatherOffset; rainIntensity: number; flash: boolean } {
    const now = Date.now();

    if (now - this.lastUpdate > this.config.intervalMs) {
      this.generateNewTarget();
      this.lastUpdate = now;
    }

    const smoothFactor = 0.008;
    this.offset.vhfShift += (this.targetOffset.vhfShift - this.offset.vhfShift) * smoothFactor;
    this.offset.uhfShift += (this.targetOffset.uhfShift - this.offset.uhfShift) * smoothFactor;
    this.offset.antennaShift += (this.targetOffset.antennaShift - this.offset.antennaShift) * smoothFactor;

    this.stormPulse = 0.5 + 0.5 * Math.sin(now * 0.001) * Math.sin(now * 0.0007);
    const rainIntensity = this.config.stormIntensity * (0.6 + 0.4 * this.stormPulse);

    if (!this.flashActive && Math.random() < 0.003) {
      this.flashActive = true;
      this.flashTimer = 0.08 + Math.random() * 0.12;
    }

    if (this.flashActive) {
      this.flashTimer -= 0.016;
      if (this.flashTimer <= 0) {
        this.flashActive = false;
      }
    }

    return {
      offset: this.offset,
      rainIntensity,
      flash: this.flashActive
    };
  }
}
