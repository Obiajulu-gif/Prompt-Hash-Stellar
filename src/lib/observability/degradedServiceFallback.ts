import { metrics } from "./metrics.js";
import { logger } from "./logger.js";

export type ThirdPartyService = "ipfs" | "stellar_rpc" | "safety_scanner";
export type ServiceDegradationStatus = "healthy" | "degraded" | "unavailable";

export interface ServiceState {
  service: ThirdPartyService;
  status: ServiceDegradationStatus;
  lastUpdated: string;
  details?: string;
}

export interface ActionPolicy {
  allowed: boolean;
  message?: string;
  fallbackActive: boolean;
}

const DEFAULT_MESSAGES: Record<ThirdPartyService, Record<ServiceDegradationStatus, string>> = {
  ipfs: {
    healthy: "IPFS storage services are operational.",
    degraded: "IPFS gateway latency is elevated. Secondary mirror gateways will be used for prompt content retrieval.",
    unavailable: "IPFS storage services are currently unavailable. Prompt creation and raw IPFS downloads are temporarily disabled.",
  },
  stellar_rpc: {
    healthy: "Stellar network RPC nodes are operational.",
    degraded: "Stellar RPC node response times are degraded. Wallet balance lookups and transactions may take longer.",
    unavailable: "Stellar network RPC nodes are currently unreachable. Prompt purchase and on-chain publishing operations are blocked for your protection.",
  },
  safety_scanner: {
    healthy: "Automated content safety scanner is operational.",
    degraded: "Content safety scanning queue is experiencing delays. Listings will be routed through async analysis.",
    unavailable: "Automated safety scanner is offline. Instant publication is disabled; all new prompt submissions require manual maintainer approval.",
  },
};

class DegradedServiceFallbackManager {
  private states: Map<ThirdPartyService, ServiceState> = new Map();
  private listeners: Set<() => void> = new Set();

  constructor() {
    this.reset();
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        logger.error({ err }, "Error in fallback status subscriber listener");
      }
    }
  }

  public getAllStates(): ServiceState[] {
    return Array.from(this.states.values());
  }

  public getDegradedServices(): ServiceState[] {
    return Array.from(this.states.values()).filter(
      (s) => s.status === "degraded" || s.status === "unavailable"
    );
  }

  public reset(): void {
    const services: ThirdPartyService[] = ["ipfs", "stellar_rpc", "safety_scanner"];
    for (const service of services) {
      this.states.set(service, {
        service,
        status: "healthy",
        lastUpdated: new Date().toISOString(),
      });
    }
    this.notify();
  }

  public setServiceStatus(
    service: ThirdPartyService,
    status: ServiceDegradationStatus,
    details?: string
  ): void {
    const currentState = this.states.get(service);
    const previousStatus = currentState?.status || "healthy";

    this.states.set(service, {
      service,
      status,
      lastUpdated: new Date().toISOString(),
      details,
    });

    if (previousStatus !== status) {
      this.notify();
      if (status === "healthy") {
        metrics.emit("service_recovered", 1, { service, previousStatus });
        logger.info({ service, previousStatus }, `Third-party service ${service} recovered to healthy`);
      } else {
        metrics.emit("fallback_activated", 1, { service, status, previousStatus });
        logger.warn({ service, status, previousStatus, details }, `Fallback activated for degraded service ${service}`);
      }
    }
  }

  public getServiceState(service: ThirdPartyService): ServiceState {
    return this.states.get(service) || {
      service,
      status: "healthy",
      lastUpdated: new Date().toISOString(),
    };
  }

  public getFallbackMessage(service: ThirdPartyService): string {
    const state = this.getServiceState(service);
    return DEFAULT_MESSAGES[service][state.status];
  }

  public evaluateAction(service: ThirdPartyService, action: string): ActionPolicy {
    const state = this.getServiceState(service);

    if (state.status === "healthy") {
      return { allowed: true, fallbackActive: false };
    }

    if (state.status === "degraded") {
      metrics.emit("degraded_action_executed", 1, { service, action });
      return {
        allowed: true,
        fallbackActive: true,
        message: this.getFallbackMessage(service),
      };
    }

    // state.status === "unavailable"
    const criticalActions: Record<ThirdPartyService, string[]> = {
      ipfs: ["publish_prompt", "upload_content"],
      stellar_rpc: ["buy_prompt", "execute_payment", "deploy_contract"],
      safety_scanner: ["auto_publish_prompt"],
    };

    const isCritical = criticalActions[service]?.includes(action) ?? false;

    if (isCritical) {
      metrics.emit("critical_action_blocked", 1, { service, action });
      logger.error({ service, action }, `Critical action ${action} blocked due to ${service} service being unavailable`);
      return {
        allowed: false,
        fallbackActive: true,
        message: this.getFallbackMessage(service),
      };
    }

    // Non-critical action in unavailable state proceeds with fallback warning
    metrics.emit("noncritical_action_fallback", 1, { service, action });
    return {
      allowed: true,
      fallbackActive: true,
      message: this.getFallbackMessage(service),
    };
  }
}

export const fallbackManager = new DegradedServiceFallbackManager();
