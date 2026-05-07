\# Prometheus and Grafana Observability



\## Goal



SCRUM-71 adds metrics-based observability for the ExamFlow platform running on GKE.



The observability stack monitors Kubernetes workloads in the `examflow` namespace.



\## Architecture



```text

GKE

├── examflow namespace

│   ├── api-service

│   ├── worker-service

│   ├── validation-service

│   ├── exam-service

│   └── mongodb

└── observability namespace

&#x20;   ├── Prometheus

&#x20;   ├── Grafana

&#x20;   ├── Alertmanager

&#x20;   ├── kube-state-metrics

&#x20;   └── node-exporter

