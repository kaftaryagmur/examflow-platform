\# Logging Format



This document describes the common structured logging format used by ExamFlow services.



\## Goal



All services should produce logs with the same base fields so that service-to-service flow can be traced from Kubernetes, Cloud Logging, or future log dashboards.



\## Common Fields



Every application log includes:



\- timestamp

\- level

\- service

\- message



Additional contextual fields may include:



\- event\_id

\- document\_id

\- event\_type

\- message\_id

\- endpoint

\- status

\- duration\_ms

\- validation\_result

\- error



\## Example



```json

{

&#x20; "timestamp": "2026-05-07T19:30:00Z",

&#x20; "level": "INFO",

&#x20; "service": "worker-service",

&#x20; "message": "processing started",

&#x20; "document\_id": "doc-123",

&#x20; "event\_type": "document.uploaded"

}

