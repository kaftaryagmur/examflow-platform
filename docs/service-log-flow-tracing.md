\# Service Log Flow Tracing



\## Goal



SCRUM-70 verifies that the asynchronous service flow can be traced through application logs.



The observed flow is:



```text

api-service -> worker-service -> validation-service -> exam-service

