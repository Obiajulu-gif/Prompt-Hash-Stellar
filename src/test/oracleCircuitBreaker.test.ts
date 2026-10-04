import { describe, it, expect, beforeEach } from "vitest";
import { OracleCircuitBreaker } from "../lib/observability/oracleCircuitBreaker";

describe("Oracle Anomaly Circuit Breaker (#332)", () => {
  let circuitBreaker: OracleCircuitBreaker;

  beforeEach(() => {
    // Threshold: 3.0 std dev, 50% max step change, 5 min history size, 2 multisig approvals required
    circuitBreaker = new OracleCircuitBreaker(3.0, 50.0, 5, 2);
  });

  it("permits normal oracle data points within standard deviation range", () => {
    const projectA = "PROJECT_SOLAR_FARM_101";

    // Feed normal baseline readings (around 100.0)
    for (let i = 0; i < 5; i++) {
      const result = circuitBreaker.processOracleDataPoint({
        projectId: projectA,
        trancheId: "TRANCHE_A",
        performanceScore: 100.0 + (i % 2 === 0 ? 1.0 : -1.0),
        timestamp: new Date().toISOString(),
      });
      expect(result.anomalyDetected).toBe(false);
      expect(circuitBreaker.isProjectTradingAllowed(projectA)).toBe(true);
    }
  });

  it("triggers scoped automatic pause when statistical anomaly threshold (> 3.0 std dev) is breached", () => {
    const projectA = "PROJECT_SOLAR_FARM_101";
    const projectB = "PROJECT_WIND_PARK_202";

    // Baseline for both projects
    for (let i = 0; i < 5; i++) {
      circuitBreaker.processOracleDataPoint({
        projectId: projectA,
        trancheId: "TRANCHE_A",
        performanceScore: 100.0,
        timestamp: new Date().toISOString(),
      });
      circuitBreaker.processOracleDataPoint({
        projectId: projectB,
        trancheId: "TRANCHE_A",
        performanceScore: 50.0,
        timestamp: new Date().toISOString(),
      });
    }

    // Anomaly on projectA: score jumps to 350.0 (> 3 std dev)
    const anomalyResult = circuitBreaker.processOracleDataPoint({
      projectId: projectA,
      trancheId: "TRANCHE_A",
      performanceScore: 350.0,
      timestamp: new Date().toISOString(),
    });

    expect(anomalyResult.anomalyDetected).toBe(true);
    expect(circuitBreaker.isProjectTradingAllowed(projectA)).toBe(false);
    expect(anomalyResult.state.status).toBe("PAUSED");
    expect(anomalyResult.state.reason).toContain("Oracle anomaly detected");

    // SCOPED BLAST RADIUS: Project B remains ACTIVE and unaffected!
    expect(circuitBreaker.isProjectTradingAllowed(projectB)).toBe(true);
  });

  it("requires explicit multisig governance action to resume trading (no automatic timeout resumption)", () => {
    const projectA = "PROJECT_SOLAR_FARM_101";

    for (let i = 0; i < 5; i++) {
      circuitBreaker.processOracleDataPoint({
        projectId: projectA,
        trancheId: "TRANCHE_A",
        performanceScore: 100.0,
        timestamp: new Date().toISOString(),
      });
    }
    // Trigger pause
    circuitBreaker.processOracleDataPoint({
      projectId: projectA,
      trancheId: "TRANCHE_A",
      performanceScore: 400.0,
      timestamp: new Date().toISOString(),
    });

    expect(circuitBreaker.isProjectTradingAllowed(projectA)).toBe(false);

    // Single multisig signature is insufficient
    const sig1 = circuitBreaker.addMultisigResumptionApproval(
      projectA,
      "GMULTISIG_KEY_1",
      "Audited anomaly - data source re-calibrated"
    );
    expect(sig1.resumed).toBe(false);
    expect(circuitBreaker.isProjectTradingAllowed(projectA)).toBe(false);

    // Second multisig signature reaches quorum (2 required)
    const sig2 = circuitBreaker.addMultisigResumptionApproval(
      projectA,
      "GMULTISIG_KEY_2",
      "Confirmed safe to resume trading"
    );
    expect(sig2.resumed).toBe(true);
    expect(circuitBreaker.isProjectTradingAllowed(projectA)).toBe(true);
  });
});
