export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface IncidentImpactQuery {
  startTime: Date;
  endTime: Date;
  affectedOperations?: string[];
  affectedRecords?: string[];
  affectedUsers?: string[];
}

export interface IncidentRecord {
  id: string;
  userId: string;
  operation: string;
  timestamp: Date;
  details: Record<string, any>;
  sensitiveData?: Record<string, any>;
}

export interface ImpactReportInternal {
  totalUsersAffected: number;
  totalRecordsAffected: number;
  totalOperationsAffected: number;
  severity: IncidentSeverity;
  affectedUserIds: string[];
  affectedRecordIds: string[];
  affectedOperationTypes: string[];
  timeWindow: {
    start: Date;
    end: Date;
  };
}

export interface ImpactReportShareable {
  totalUsersAffected: number;
  totalRecordsAffected: number;
  totalOperationsAffected: number;
  severity: IncidentSeverity;
  affectedOperationTypes: string[];
  timeWindow: {
    start: Date;
    end: Date;
  };
  // Sensitive IDs omitted
}

export interface ImpactReport {
  internal: ImpactReportInternal;
  shareable: ImpactReportShareable;
}

export class ImpactCalculator {
  private records: IncidentRecord[];

  constructor(records: IncidentRecord[]) {
    this.records = records;
  }

  public calculate(query: IncidentImpactQuery): ImpactReport {
    const affected = this.records.filter((record) => {
      const timeValid = record.timestamp >= query.startTime && record.timestamp <= query.endTime;
      if (!timeValid) return false;

      const opValid = !query.affectedOperations || query.affectedOperations.includes(record.operation);
      const recValid = !query.affectedRecords || query.affectedRecords.includes(record.id);
      const userValid = !query.affectedUsers || query.affectedUsers.includes(record.userId);

      return opValid && recValid && userValid;
    });

    const userIds = Array.from(new Set(affected.map((r) => r.userId))).sort();
    const recordIds = Array.from(new Set(affected.map((r) => r.id))).sort();
    const operationTypes = Array.from(new Set(affected.map((r) => r.operation))).sort();

    const totalUsers = userIds.length;
    const totalRecords = recordIds.length;
    
    let severity: IncidentSeverity = 'low';
    if (totalUsers > 100 || totalRecords > 1000) {
      severity = 'critical';
    } else if (totalUsers > 50 || totalRecords > 500) {
      severity = 'high';
    } else if (totalUsers > 10 || totalRecords > 100) {
      severity = 'medium';
    }

    const internalReport: ImpactReportInternal = {
      totalUsersAffected: totalUsers,
      totalRecordsAffected: totalRecords,
      totalOperationsAffected: affected.length,
      severity,
      affectedUserIds: userIds,
      affectedRecordIds: recordIds,
      affectedOperationTypes: operationTypes,
      timeWindow: {
        start: query.startTime,
        end: query.endTime,
      },
    };

    const shareableReport: ImpactReportShareable = {
      totalUsersAffected: totalUsers,
      totalRecordsAffected: totalRecords,
      totalOperationsAffected: affected.length,
      severity,
      affectedOperationTypes: operationTypes,
      timeWindow: {
        start: query.startTime,
        end: query.endTime,
      },
    };

    return {
      internal: internalReport,
      shareable: shareableReport,
    };
  }
}
