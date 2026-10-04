export interface OracleDataPoint {
  projectId: string;
  trancheId: string;
  performanceScore: number; // e.g. 0.0 to 100.0 or yield rate
  timestamp: string;
}

export type CircuitBreakerStatus = "ACTIVE" | "PAUSED";

export interface ProjectCircuitState {
  projectId: string;
  status: CircuitBreakerStatus;
  pausedAt?: string;
  reason?: string;
  anomalyDetails?: {
    latestScore: number;
    mean: number;
    stdDev: number;
    zScore: number;
  };
  multisigResumptionApprovals: string[];
}

export class OracleCircuitBreaker {
  private history: Map<string, number[]> = new Map();
  private circuitStates: Map<string, ProjectCircuitState> = new Map();
  private zScoreThreshold: number; // e.g. 3.0 standard deviations
  private maxStepChangePct: number; // e.g. 50% max single reading jump
  private minHistorySize: number;
  private requiredMultisigSignatures: number;

  constructor(
    zScoreThreshold: number = 3.0,
    maxStepChangePct: number = 50.0,
    minHistorySize: number = 5,
    requiredMultisigSignatures: number = 2
  ) {
    this.zScoreThreshold = zScoreThreshold;
    this.maxStepChangePct = maxStepChangePct;
    this.minHistorySize = minHistorySize;
    this.requiredMultisigSignatures = requiredMultisigSignatures;
  }

  private getProjectState(projectId: string): ProjectCircuitState {
    if (!this.circuitStates.has(projectId)) {
      this.circuitStates.set(projectId, {
        projectId,
        status: "ACTIVE",
        multisigResumptionApprovals: [],
      });
    }
    return this.circuitStates.get(projectId)!;
  }

  public isProjectTradingAllowed(projectId: string): boolean {
    const state = this.getProjectState(projectId);
    return state.status === "ACTIVE";
  }

  public getCircuitStatus(projectId: string): ProjectCircuitState {
    return this.getProjectState(projectId);
  }

  /**
   * Evaluates incoming oracle data point against statistical anomaly thresholds.
   * Scoped blast radius: Pauses affected project/tranche ONLY without affecting other projects.
   */
  public processOracleDataPoint(data: OracleDataPoint): { anomalyDetected: boolean; state: ProjectCircuitState } {
    const state = this.getProjectState(data.projectId);

    if (state.status === "PAUSED") {
      return { anomalyDetected: true, state };
    }

    const readings = this.history.get(data.projectId) || [];

    if (readings.length >= this.minHistorySize) {
      const mean = readings.reduce((a, b) => a + b, 0) / readings.length;
      const variance = readings.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / readings.length;
      const stdDev = Math.sqrt(variance) || 1e-6;
      const zScore = Math.abs((data.performanceScore - mean) / stdDev);

      const previousReading = readings[readings.length - 1];
      const stepChangePct = previousReading > 0
        ? Math.abs((data.performanceScore - previousReading) / previousReading) * 100
        : 0;

      const isAnomalousZScore = zScore > this.zScoreThreshold;
      const isAnomalousStepChange = stepChangePct > this.maxStepChangePct;

      if (isAnomalousZScore || isAnomalousStepChange) {
        state.status = "PAUSED";
        state.pausedAt = new Date().toISOString();
        state.reason = `Oracle anomaly detected: score ${data.performanceScore} (Mean=${mean.toFixed(2)}, StdDev=${stdDev.toFixed(2)}, ZScore=${zScore.toFixed(2)}, StepChange=${stepChangePct.toFixed(1)}%).`;
        state.anomalyDetails = {
          latestScore: data.performanceScore,
          mean,
          stdDev,
          zScore,
        };

        return { anomalyDetected: true, state };
      }
    }

    // Record valid reading into trailing history (keep max 30 observations)
    readings.push(data.performanceScore);
    if (readings.length > 30) {
      readings.shift();
    }
    this.history.set(data.projectId, readings);

    return { anomalyDetected: false, state };
  }

  /**
   * Resumption Protocol: Requires explicit governance / multisig action.
   * Automatic timeout resumption is strictly disabled.
   */
  public addMultisigResumptionApproval(
    projectId: string,
    signerKey: string,
    reason: string
  ): { resumed: boolean; currentApprovalsCount: number; message: string } {
    const state = this.getProjectState(projectId);

    if (state.status === "ACTIVE") {
      return { resumed: true, currentApprovalsCount: 0, message: "Project circuit breaker is already active." };
    }

    if (!state.multisigResumptionApprovals.includes(signerKey)) {
      state.multisigResumptionApprovals.push(signerKey);
    }

    if (state.multisigResumptionApprovals.length >= this.requiredMultisigSignatures) {
      state.status = "ACTIVE";
      state.pausedAt = undefined;
      state.reason = undefined;
      state.anomalyDetails = undefined;
      state.multisigResumptionApprovals = [];

      return {
        resumed: true,
        currentApprovalsCount: this.requiredMultisigSignatures,
        message: `Multisig quorum reached. Project ${projectId} circuit breaker successfully resumed.`,
      };
    }

    return {
      resumed: false,
      currentApprovalsCount: state.multisigResumptionApprovals.length,
      message: `Approval recorded. Requires ${this.requiredMultisigSignatures - state.multisigResumptionApprovals.length} more multisig signature(s).`,
    };
  }
}
