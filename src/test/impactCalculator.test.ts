import { describe, it, expect } from 'vitest';
import { ImpactCalculator, IncidentRecord } from '../services/impactCalculator';

describe('ImpactCalculator', () => {
  const mockRecords: IncidentRecord[] = [
    {
      id: 'rec1',
      userId: 'user1',
      operation: 'PUBLISH_PROMPT',
      timestamp: new Date('2023-10-01T10:00:00Z'),
      details: { foo: 'bar' },
      sensitiveData: { secret: 'hidden' },
    },
    {
      id: 'rec2',
      userId: 'user2',
      operation: 'BUY_PROMPT',
      timestamp: new Date('2023-10-01T10:15:00Z'),
      details: { price: 100 },
    },
    {
      id: 'rec3',
      userId: 'user1',
      operation: 'PUBLISH_PROMPT',
      timestamp: new Date('2023-10-01T11:00:00Z'),
      details: {},
    },
  ];

  const calculator = new ImpactCalculator(mockRecords);

  it('should return deterministic results for a narrow incident', () => {
    const report = calculator.calculate({
      startTime: new Date('2023-10-01T09:00:00Z'),
      endTime: new Date('2023-10-01T10:30:00Z'),
      affectedUsers: ['user1'],
    });

    expect(report.internal.totalUsersAffected).toBe(1);
    expect(report.internal.affectedUserIds).toEqual(['user1']);
    expect(report.internal.totalRecordsAffected).toBe(1);
    expect(report.internal.affectedRecordIds).toEqual(['rec1']);
    expect(report.internal.affectedOperationTypes).toEqual(['PUBLISH_PROMPT']);
    expect(report.internal.severity).toBe('low');
  });

  it('should return deterministic results for a broad incident', () => {
    const report = calculator.calculate({
      startTime: new Date('2023-10-01T09:00:00Z'),
      endTime: new Date('2023-10-01T12:00:00Z'),
    });

    expect(report.internal.totalUsersAffected).toBe(2);
    expect(report.internal.affectedUserIds).toEqual(['user1', 'user2']);
    expect(report.internal.totalRecordsAffected).toBe(3);
    expect(report.internal.affectedRecordIds).toEqual(['rec1', 'rec2', 'rec3']);
    expect(report.internal.affectedOperationTypes).toEqual(['BUY_PROMPT', 'PUBLISH_PROMPT']);
  });

  it('should return no impact when there are no matching records', () => {
    const report = calculator.calculate({
      startTime: new Date('2023-10-02T09:00:00Z'),
      endTime: new Date('2023-10-02T12:00:00Z'),
    });

    expect(report.internal.totalUsersAffected).toBe(0);
    expect(report.internal.totalRecordsAffected).toBe(0);
    expect(report.internal.severity).toBe('low');
    expect(report.internal.affectedUserIds).toEqual([]);
    expect(report.shareable.totalUsersAffected).toBe(0);
  });

  it('should separate internal and shareable fields and redact sensitive details from shareable export', () => {
    const report = calculator.calculate({
      startTime: new Date('2023-10-01T09:00:00Z'),
      endTime: new Date('2023-10-01T12:00:00Z'),
    });

    // Internal should have the sensitive IDs
    expect(report.internal.affectedUserIds).toBeDefined();
    expect(report.internal.affectedRecordIds).toBeDefined();

    // Shareable should not have the sensitive IDs
    expect((report.shareable as any).affectedUserIds).toBeUndefined();
    expect((report.shareable as any).affectedRecordIds).toBeUndefined();
    expect((report.shareable as any).sensitiveData).toBeUndefined();
    
    // Both should have aggregated data
    expect(report.shareable.totalUsersAffected).toBe(report.internal.totalUsersAffected);
    expect(report.shareable.severity).toBe(report.internal.severity);
  });
  
  it('should calculate severity correctly', () => {
      const manyRecords = Array.from({length: 105}).map((_, i) => ({
          id: `rec${i}`,
          userId: `user${i}`,
          operation: 'TEST',
          timestamp: new Date('2023-10-01T10:00:00Z'),
          details: {}
      }));
      const calcMany = new ImpactCalculator(manyRecords);
      const report = calcMany.calculate({
          startTime: new Date('2023-10-01T09:00:00Z'),
          endTime: new Date('2023-10-01T11:00:00Z')
      });
      expect(report.internal.severity).toBe('critical'); // > 100 users
  });
});
