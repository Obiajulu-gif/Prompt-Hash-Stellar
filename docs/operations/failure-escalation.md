# Configurable failure escalation (#904)

Unresolved failures in `OperationFailure` escalate by severity and age, so a
maintainer does not miss a user-impacting failure. Each failure gets a notification
when its rule says so, repeats on the rule's interval, and stops once it is resolved
or the rule's budget is spent.

Source: `server/src/services/failureEscalation.ts`,
`server/src/routes/failureEscalationRoutes.ts`, and the `escalation` field on
`server/src/models/OperationFailure.ts`.

## Policy

A policy has a `version` and exactly one rule for each severity: `low`, `medium`,
`high`, and `critical`.

| Field             | Rule                                                       |
| ----------------- | ---------------------------------------------------------- |
| `severity`        | One of the four severities                                 |
| `afterMs`         | Milliseconds after `firstFailedAt` before the first notice (0 to 30 days) |
| `repeatEveryMs`   | Interval between later notices (1 minute to 30 days)       |
| `maxNotifications`| Notices allowed for one failure (1 to 50)                  |
| `channel`         | Where the notice goes, such as `on_call` (1 to 40 characters) |

Default policy:

| Severity | First notice after | Repeats every | Max notices | Channel     |
| -------- | ------------------ | ------------- | ----------- | ----------- |
| critical | immediately        | 30 min        | 10          | on_call     |
| high     | 2 h                | 2 h           | 5           | maintainers |
| medium   | 12 h               | 12 h          | 3           | maintainers |
| low      | 24 h               | 24 h          | 2           | maintainers |

Override it by setting `ESCALATION_POLICY_JSON` to a full policy document. An
invalid value is an error, not a silent fall-back to the default. `GET
/api/admin/escalations/policy` returns the active policy, or a `500` with
`code: invalid_policy` and every issue found.

## Evaluation

For a failure that has not been resolved, notice *n* (1-based) is due at
`firstFailedAt + afterMs + (n - 1) × repeatEveryMs`.

| Status        | Meaning                                                    |
| ------------- | ---------------------------------------------------------- |
| `resolved`    | `resolvedAt` is set. Escalation stops.                     |
| `not_yet_due` | The first window has not opened.                           |
| `scheduled`   | Notices have started; the next repeat is in the future.    |
| `due`         | The next notice should be sent now.                        |
| `exhausted`   | `maxNotifications` has been reached. No more notices.      |

## Routes

Mounted at `/api/admin/escalations`.

| Method and path | Scope               | Purpose                                              |
| --------------- | ------------------- | ---------------------------------------------------- |
| `GET /policy`   | `escalations:read`  | The active policy                                    |
| `GET /report`   | `escalations:read`  | Escalations that have started, most severe first     |
| `POST /sweep`   | `escalations:write` | Send each due notice once, then record it            |

The report lists `due`, `scheduled`, and `exhausted` failures, with
`notificationsSent`, `maxNotifications`, and `nextDueAt`. It counts resolved and
not-yet-due failures without listing them.

## Sends and state

Each notice is claimed before it is sent. The claim is a guarded update that
increments `escalation.notificationsSent` only if the count still matches what the
sweep read. Overlapping sweeps therefore cannot both notify. A failed send releases
the claim and records `escalation.lastError`.

The failure record keeps:

- `notificationsSent`: notices that were claimed and not released
- `notificationAttempts`: every claim, including those that failed
- `lastEscalatedAt`, `lastAttemptAt`, and `policyVersion`

**Trade-off.** A process that stops between the claim and the send misses that
one notice. Duplicates are never sent, and the failure still appears as an active
escalation in the report, so an operator can see it.

The default notifier writes a log line and a `failure_escalated` audit row, and
the audit write must succeed for the notice to count. Connect a real channel by
passing a different `EscalationNotifier` to `runEscalationSweep`.

## Tests

`server/src/tests/failureEscalation.test.ts` covers the first notice, repeats,
exhaustion, resolution, a policy change that moves a failure from due to not yet
due, policy validation (every issue reported in one pass), the report ordering, and
the sweep's claim and release paths.
