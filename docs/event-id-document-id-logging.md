# Event ID and Document ID Logging

## Goal

SCRUM-69 makes event and document identifiers visible in service logs.

The same event_id is propagated through the main asynchronous flow:

api-service -> worker-service -> validation-service -> exam-service

## Fields

Relevant application logs include:

- event_id
- document_id
- event_type
- message_id
- service
- message

## Flow

1. api-service creates an eventId when a document upload event is created.
2. worker-service reads the incoming eventId and includes it in processing logs.
3. worker-service publishes document.processed with the same eventId.
4. validation-service reads the same eventId and includes it in validation logs.
5. validation-service publishes exam.validation.completed with the same eventId.
6. exam-service reads the same eventId and includes it in exam lifecycle logs.

## Example

```json
{
  "timestamp": "2026-05-07T19:30:00Z",
  "level": "INFO",
  "service": "validation-service",
  "message": "validation completed",
  "event_id": "upload-doc-69-123456789",
  "document_id": "doc-69",
  "validation_result": "valid"
}
