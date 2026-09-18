# Direct-message idempotency

Direct-message sends use one client-generated idempotency key for the full
logical send attempt. The same key must be reused when a response is lost,
the WebSocket reconnects, or the user taps retry.

## Contract

- HTTP `POST /api/messages/:userId` accepts the key in the `Idempotency-Key`
  header. The JSON fallback used by the native API helper is
  `idempotencyKey`.
- WebSocket `chat` frames require `idempotencyKey`.
- Keys must contain 1–128 visible ASCII characters. Keys are scoped to the
  authenticated sender and direct conversation.
- A repeated key returns the original message. It does not update the
  conversation timestamp or create a second notification or delivery
  obligation.
- A key with different content intentionally returns the original message;
  clients must generate a new key for a new logical message.

The database unique index is the concurrency boundary. The insert uses
`ON CONFLICT DO NOTHING`, then reads the committed row, so concurrent HTTP
and WebSocket sends converge on one persisted message before notifications
or delivery obligations are created.

## Migration and verification

Migration `0017_message_idempotency.sql` backfills existing rows with stable
legacy keys before enforcing the non-null unique index. It is append-only and
must be applied by the normal release migration procedure before authenticated
traffic is enabled.

The regression coverage includes key validation, strict WebSocket schema
enforcement, migration manifest integrity, and the existing direct-message
authorization suite. A PostgreSQL disposable-environment test should exercise
concurrent same-key HTTP/Worker-facing inserts and verify one message,
notification, and delivery obligation before a release claims provider-level
concurrency evidence.