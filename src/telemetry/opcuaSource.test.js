/**
 * OPC-UA 게이트웨이 메시지 프로토콜 계약 검사.
 *  실제 게이트웨이를 붙이기 전에 파서가 잘못된 프레임에 죽지 않고,
 *  올바른 프레임을 정확히 해석하는지 못 박는다.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_ALARM_DETAIL_LEN,
  MAX_ALARM_TITLE_LEN,
  MAX_ASSETS_PER_LINE,
  MAX_FRAME_BYTES,
  MAX_LINES_PER_FRAME,
  parseGatewayMessage,
  retryDelayMs,
} from './opcuaSource.js';

describe('parseGatewayMessage', () => {
  it('올바른 telemetry 프레임을 해석한다', () => {
    const r = parseGatewayMessage(
      JSON.stringify({
        type: 'telemetry',
        readings: { L1: { CONVEYOR_UNIT: { temp: 41.2, vib: 2.1, amp: 6.8 } } },
        latencyMs: 12,
      })
    );
    expect(r.kind).toBe('telemetry');
    expect(r.readings.L1.CONVEYOR_UNIT.temp).toBe(41.2);
    expect(r.latencyMs).toBe(12);
  });

  it('숫자가 아닌 계측값은 설비 단위로 버리고 나머지는 살린다', () => {
    const r = parseGatewayMessage(
      JSON.stringify({
        type: 'telemetry',
        readings: {
          L1: {
            CONVEYOR_UNIT: { temp: 'NaN아님', vib: 2, amp: 3 }, // 깨진 설비 — 버림
            CUTTING_UNIT: { temp: 58, vib: 4.2, amp: 12.5 }, // 정상 — 유지
          },
        },
      })
    );
    expect(r.kind).toBe('telemetry');
    expect(r.readings.L1.CONVEYOR_UNIT).toBeUndefined();
    expect(r.readings.L1.CUTTING_UNIT.amp).toBe(12.5);
  });

  it('전부 깨진 telemetry 는 invalid 로 판정한다', () => {
    const r = parseGatewayMessage(
      JSON.stringify({ type: 'telemetry', readings: { L1: { X: { temp: 'a', vib: 'b', amp: 'c' } } } })
    );
    expect(r.kind).toBe('invalid');
  });

  it('올바른 alarm 프레임은 FAULT_SCENARIOS 형태로 해석된다', () => {
    const r = parseGatewayMessage(
      JSON.stringify({
        type: 'alarm',
        lineId: 'L1',
        assetId: 'CUTTING_UNIT',
        code: 'E-9001',
        title: '테스트 알람',
        detail: '상세',
      })
    );
    expect(r.kind).toBe('alarm');
    expect(r.alarm).toEqual({
      lineId: 'L1',
      assetId: 'CUTTING_UNIT',
      code: 'E-9001',
      title: '테스트 알람',
      detail: '상세',
    });
  });

  it('알람 필수 필드가 빠지면 invalid', () => {
    const r = parseGatewayMessage(JSON.stringify({ type: 'alarm', lineId: 'L1', code: 'E-1' }));
    expect(r.kind).toBe('invalid');
  });

  it('JSON 이 아니거나 알 수 없는 type 이면 invalid — 절대 throw 하지 않는다', () => {
    expect(parseGatewayMessage('{{{').kind).toBe('invalid');
    expect(parseGatewayMessage('null').kind).toBe('invalid');
    expect(parseGatewayMessage(JSON.stringify({ type: 'heartbeat' })).kind).toBe('invalid');
  });

  it('[리뷰수정] null·빈문자열·불리언 계측값은 0/1 로 둔갑하지 않고 버려진다', () => {
    const r = parseGatewayMessage(
      JSON.stringify({
        type: 'telemetry',
        readings: {
          L1: {
            DEAD_A: { temp: null, vib: null, amp: null }, // 죽은 센서 — Number(null)=0 함정
            DEAD_B: { temp: '', vib: '3', amp: 5 }, // 문자열 숫자도 거부
            DEAD_C: { temp: true, vib: 1, amp: 2 }, // Number(true)=1 함정
            LIVE: { temp: 40.5, vib: 2.0, amp: 6.1 },
          },
        },
      })
    );
    expect(r.kind).toBe('telemetry');
    expect(r.readings.L1.DEAD_A).toBeUndefined();
    expect(r.readings.L1.DEAD_B).toBeUndefined();
    expect(r.readings.L1.DEAD_C).toBeUndefined();
    expect(r.readings.L1.LIVE.temp).toBe(40.5);
  });

  it('[리뷰수정] latencyMs 도 숫자 타입만 인정한다', () => {
    const frame = (latencyMs) =>
      parseGatewayMessage(
        JSON.stringify({ type: 'telemetry', readings: { L1: { A: { temp: 1, vib: 1, amp: 1 } } }, latencyMs })
      );
    expect(frame('12').latencyMs).toBeNull();
    expect(frame(null).latencyMs).toBeNull();
    expect(frame(12).latencyMs).toBe(12);
  });

  it('[리뷰수정] 상한 초과 프레임은 파싱 전에 거부한다 — 메인 스레드 보호', () => {
    const huge = '"' + 'x'.repeat(MAX_FRAME_BYTES + 10) + '"';
    expect(parseGatewayMessage(huge).kind).toBe('invalid');
    expect(parseGatewayMessage(12345).kind).toBe('invalid'); // 텍스트 프레임이 아님
  });

  it('[리뷰수정] 라인·설비 수는 상한까지만 받는다 — 키 스팸이 버퍼를 태우지 못하게', () => {
    const manyAssets = Object.fromEntries(
      Array.from({ length: MAX_ASSETS_PER_LINE + 20 }, (_, i) => [`A${i}`, { temp: 1, vib: 1, amp: 1 }])
    );
    const manyLines = Object.fromEntries(
      Array.from({ length: MAX_LINES_PER_FRAME + 10 }, (_, i) => [`L${i}`, { X: { temp: 1, vib: 1, amp: 1 } }])
    );
    const r1 = parseGatewayMessage(JSON.stringify({ type: 'telemetry', readings: { L1: manyAssets } }));
    expect(Object.keys(r1.readings.L1).length).toBeLessThanOrEqual(MAX_ASSETS_PER_LINE);
    const r2 = parseGatewayMessage(JSON.stringify({ type: 'telemetry', readings: manyLines }));
    expect(Object.keys(r2.readings).length).toBeLessThanOrEqual(MAX_LINES_PER_FRAME);
  });

  it('[리뷰수정] 알람 제목·상세는 상한 길이로 잘라 화면에 올린다', () => {
    const r = parseGatewayMessage(
      JSON.stringify({
        type: 'alarm',
        lineId: 'L1',
        assetId: 'X',
        code: 'E-1',
        title: 't'.repeat(MAX_ALARM_TITLE_LEN + 500),
        detail: 'd'.repeat(MAX_ALARM_DETAIL_LEN + 500),
      })
    );
    expect(r.kind).toBe('alarm');
    expect(r.alarm.title.length).toBe(MAX_ALARM_TITLE_LEN);
    expect(r.alarm.detail.length).toBe(MAX_ALARM_DETAIL_LEN);
  });
});

describe('retryDelayMs — 지수 백오프', () => {
  it('2s → 4 → 8 → 16 상한 15s', () => {
    expect(retryDelayMs(1)).toBe(2000);
    expect(retryDelayMs(2)).toBe(4000);
    expect(retryDelayMs(3)).toBe(8000);
    expect(retryDelayMs(4)).toBe(15000); // 16000 이 상한 15000 에 걸림
    expect(retryDelayMs(99)).toBe(15000);
  });
});
