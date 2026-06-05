# ExamFlow Project Context

## Project Summary

ExamFlow is a graduation project focused on a cloud-native, event-driven exam generation platform.

The main goal is to demonstrate backend architecture, microservices, Kubernetes orchestration, CI/CD, Pub/Sub-based communication, MongoDB persistence, and observability.

The project currently prioritizes backend and DevOps/cloud-native architecture over a production-grade frontend.

## Current Architecture

The expected service flow is:

User
-> API Service
-> Google Pub/Sub
-> Worker Service
-> Validation Service
-> Exam Service
-> MongoDB

Services should not directly call each other for the main processing pipeline. They communicate through events using Pub/Sub.

## Main Kubernetes Namespace

Application namespace:

examflow

Expected deployments/services include:

- api-service
- worker-service
- validation-service
- exam-service
- mongodb

Observability namespace:

observability

Expected observability components:

- Prometheus
- Grafana

## Backend Demo Flow

The current working demo flow is API-based and should be preserved:

1. Show Kubernetes resources:
   - pods
   - deployments
   - services
   - PVC
   - HPA if available

2. Port-forward api-service.

3. Check:
   - GET /health
   - GET /ready

4. Register a demo user:
   - POST /auth/register

5. Login and receive JWT:
   - POST /auth/login

6. Show that /publish is protected:
   - POST /publish without token should fail with 401 or auth error.

7. Publish with token:
   - POST /publish with Authorization: Bearer <TOKEN>

8. Track the same DOC_ID in logs:
   - api-service
   - worker-service
   - validation-service
   - exam-service

9. Verify MongoDB records:
   - documents collection
   - exams collection

## Security / Ownership Rules

- /publish must require JWT.
- API service should derive user ownership from the JWT.
- Do not trust userId from the request body if JWT already provides the authenticated user.
- Documents and exams should be associated with the authenticated user.
- Do not commit secrets, JWT tokens, passwords, kubeconfig files, service account keys, or .env files.

## CI/CD Context

Jenkins is used for CI/CD.

Expected pipeline idea:

- main branch build
- tests
- Docker image build
- push to Artifact Registry
- deploy to GKE
- rollout verification
- smoke test

Do not break existing Jenkinsfile or Kubernetes deployment flow unless the task explicitly requires it.

## Frontend / Demo UI Scope

Frontend work is now planned under Jira epic SCRUM-25 DEMO & PUBLIC.

Relevant Jira tasks:

- SCRUM-30: Demo: Public demo UI geliştirilmesi (/demo route)
- SCRUM-41: Demo: End-to-end processing state ekranının eklenmesi
- SCRUM-42: Deployment: Demo UI’ın containerize edilmesi ve Kubernetes’e alınması
- SCRUM-43: Deployment: Ingress veya public endpoint ile demo erişiminin açılması

These tasks mean the project should have a minimal public demo UI.

The demo UI should be simple and presentation-oriented, not a full production frontend.

Recommended frontend behavior:

- Public /demo route.
- User can register/login or use a simple demo login flow.
- User can trigger a document publish request.
- UI shows processing states such as:
  - received
  - processing
  - validated
  - published
  - failed
- UI should show the result on one screen.
- UI should call the existing API endpoints instead of duplicating backend logic.

## Frontend Implementation Guidelines

Prefer a minimal implementation that is easy to demo.

Acceptable stack if no frontend exists yet:

- React + Vite
- simple CSS
- Dockerfile
- Kubernetes Deployment
- Kubernetes Service

Do not over-engineer.

The demo UI should be deployable to Kubernetes and accessible through either:

- LoadBalancer service, or
- Ingress/public endpoint if already configured.

## Observability Context

Prometheus and Grafana are installed/planned for observability.

Grafana may require LoadBalancer/root_url/domain fixes.

Do not present Grafana as the core product. It is an observability layer for showing operational visibility.

## Important Commands

Useful commands for project inspection:

kubectl get pods -n examflow -o wide
kubectl get deploy,svc,pvc,hpa -n examflow -o wide
kubectl rollout status deployment/api-service -n examflow
kubectl rollout status deployment/worker-service -n examflow
kubectl rollout status deployment/validation-service -n examflow
kubectl rollout status deployment/exam-service -n examflow

Check API:

curl -s http://localhost:8080/health | jq
curl -s http://localhost:8080/ready | jq

Search for frontend:

find . -maxdepth 3 -type d | grep -Ei "frontend|ui|web|client|demo"
find . -maxdepth 3 -type f \( -name "package.json" -o -name "vite.config.*" -o -name "next.config.*" -o -name "Dockerfile" \) | sort

## How Codex Should Work

Before changing code:

1. Inspect repository structure.
2. Identify whether frontend already exists.
3. If frontend exists, extend it minimally.
4. If frontend does not exist, create a minimal demo UI.
5. Keep backend API contracts intact.
6. Keep Kubernetes/Jenkins conventions consistent with the current repo.
7. Make small, reviewable changes.
8. After changes, provide exact test commands.

## Definition of Done for Demo UI

A frontend/demo task is done when:

- UI code exists in the repository.
- It can be run locally.
- It can call the API or be configured with API base URL.
- It has a Dockerfile.
- It has Kubernetes manifests.
- It can be exposed through a service/public endpoint.
- README or usage notes include how to run and demo it.