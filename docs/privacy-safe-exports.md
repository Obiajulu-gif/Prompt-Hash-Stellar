# Privacy-safe exports

Request an export with the existing export write scope. Download the completed
artifact with the export read scope. A user exporting their own records may
download the integrity digest. A cross-user administrator export omits that
digest and always excludes encrypted content, raw wallet IDs, and internal
lifecycle notes. Owner-created artifacts can only be downloaded by their owner.

Exports expire after 24 hours. The service reconstructs the artifact and
compares its checksum before transmitting any records. If the data or export
format changed, create a new export and use its new download link. An interrupted
transfer does not publish a download.