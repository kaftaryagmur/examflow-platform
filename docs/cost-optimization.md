# ExamFlow Development Cost Optimization

The development environment is designed to be ephemeral. The GKE cluster can be deleted after development, then recreated from Kubernetes manifests and the Jenkins pipeline.

## Default Strategy

| Resource | Daily action | Long break action | Why |
| --- | --- | --- | --- |
| GKE cluster | Delete | Delete | Stops node compute and cluster-level costs. |
| Jenkins VM | Stop | Delete after disk decision | Stops VM CPU and memory costs. |
| Persistent disks | Keep only if needed | Delete or snapshot | Durable disks are billed while provisioned. |
| Artifact Registry images | Keep recent tags | Clean old tags | Image storage grows over time. |
| Static external IPs | Keep only if required | Release | Unused static IPs can continue billing. |

## Start Development

```bash
./scripts/start-dev.sh
```

On Windows PowerShell:

```powershell
.\scripts\start-dev.ps1
```

Defaults:

```bash
PROJECT_ID=bitirme-pubsub
REGION=europe-west1
CLUSTER_NAME=examflow-cluster
CLUSTER_LOCATION=europe-west1
CLUSTER_LOCATION_FLAG=--region
GKE_MODE=autopilot
VM_NAME=jenkins-server
VM_ZONE=us-central1-a
K8S_OVERLAY=k8s/overlays/prod
```

Override any value when needed:

```bash
PROJECT_ID=my-project VM_ZONE=europe-west1-b ./scripts/start-dev.sh
```

For the lowest development cost, you can use a zonal GKE cluster instead of a regional one:

```bash
GKE_MODE=standard CLUSTER_LOCATION_FLAG=--zone CLUSTER_LOCATION=europe-west1-b ./scripts/start-dev.sh
```

If you switch to a zonal cluster, update the Jenkins `gcloud container clusters get-credentials` command to use `--zone` for the same location.

The start script also checks the Pub/Sub topic and subscriptions used by the services:

```bash
PUBSUB_TOPIC=document-events
PUBSUB_SUBSCRIPTIONS="document-events-worker document-events-validation document-events-exam"
```

## Stop Development

```bash
./scripts/stop-dev.sh
```

On Windows PowerShell:

```powershell
.\scripts\stop-dev.ps1
```

This stops the Jenkins VM and deletes the GKE cluster by default.

To stop only the VM:

```bash
DELETE_GKE=false ./scripts/stop-dev.sh
```

To delete only the GKE cluster:

```bash
STOP_VM=false ./scripts/stop-dev.sh
```

PowerShell examples:

```powershell
$env:DELETE_GKE="false"
.\scripts\stop-dev.ps1

$env:STOP_VM="false"
.\scripts\stop-dev.ps1
```

## Secret Management

Do not commit real secrets to the repository. Use one of these approaches during recreation:

```bash
kubectl create secret generic examflow-secret \
  --namespace=examflow \
  --from-literal=APP_ENV=staging
```

For production-like usage, prefer Jenkins credentials or Google Secret Manager.

## Cleanup Checklist

Run this checklist weekly while using trial credits:

- Check unattached persistent disks and old snapshots.
- Remove unused static external IP addresses.
- Delete old Artifact Registry image tags.
- Review Cloud Logging volume if logs are noisy.
- Confirm Billing budget alerts at 50%, 75%, and 90%.

## Presentation Note

Development ortami ephemeral tasarlandi. Altyapi silinse bile Kubernetes manifestleri ve CI/CD pipeline sayesinde sistem kisa surede yeniden kurulabiliyor.
