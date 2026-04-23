import * as React from "react";
import { Server, Api } from "@stellar/stellar-sdk/rpc";
import { xdr } from "@stellar/stellar-sdk";
import { rpcUrl, stellarNetwork } from "../contracts/util";

/**
 * Concatenated `${contractId}:${topic ?? "*"}`
 */
type PagingKey = string;

/**
 * Paging tokens for each contract/topic pair. These can be mutated directly,
 * rather than being stored as state within the React hook.
 */
const paging: Record<
  PagingKey,
  { lastLedgerStart?: number; pagingToken?: string }
> = {};

// NOTE: Server is configured using envvars which shouldn't change during runtime
const server = new Server(rpcUrl, { allowHttp: stellarNetwork === "LOCAL" });

/**
 * Subscribe to events from a given contract, optionally filtered by topic.
 *
 * When `topic` is omitted, all events from the contract are delivered.
 * The `onEvent` callback is held in a ref so the poll loop is not restarted
 * when the callback identity changes between renders.
 */
export function useSubscription(
  contractId: string,
  topic: string | undefined,
  onEvent: (event: Api.EventResponse) => void,
  pollInterval = 5000,
) {
  const id = `${contractId}:${topic ?? "*"}`;

  // Stable ref so the poll loop doesn't restart when onEvent identity changes.
  const onEventRef = React.useRef(onEvent);
  React.useLayoutEffect(() => {
    onEventRef.current = onEvent;
  });

  React.useEffect(() => {
    // Don't start polling when contract is not configured.
    if (!contractId) return;

    paging[id] = paging[id] || {};
    let timeoutId: NodeJS.Timeout | null = null;
    let stop = false;

    async function pollEvents(): Promise<void> {
      try {
        if (!paging[id].lastLedgerStart) {
          const latestLedgerState = await server.getLatestLedger();
          paging[id].lastLedgerStart = latestLedgerState.sequence;
        }

        const topicFilter = topic
          ? { topics: [[xdr.ScVal.scvSymbol(topic).toXDR("base64")]] }
          : {};

        // @ts-ignore
        const response = await server.getEvents({
          startLedger: !paging[id].pagingToken
            ? paging[id].lastLedgerStart
            : undefined,
          cursor: paging[id].pagingToken as string,
          filters: [
            {
              contractIds: [contractId],
              ...topicFilter,
              type: "contract",
            },
          ],
          limit: 10,
        });

        paging[id].pagingToken = undefined;
        if (response.latestLedger) {
          paging[id].lastLedgerStart = response.latestLedger;
        }
        if (response.events) {
          response.events.forEach((event) => {
            try {
              onEventRef.current(event);
            } catch (error) {
              console.error(
                "Poll Events: subscription callback had error: ",
                error,
              );
            } finally {
              // @ts-ignore
              paging[id].pagingToken = event.pagingToken;
            }
          });
        }
      } catch (error) {
        console.error("Poll Events: error: ", error);
      } finally {
        if (!stop) {
          timeoutId = setTimeout(() => void pollEvents(), pollInterval);
        }
      }
    }

    void pollEvents();

    return () => {
      if (timeoutId != null) clearTimeout(timeoutId);
      stop = true;
    };
  }, [contractId, topic, id, pollInterval]);
}
