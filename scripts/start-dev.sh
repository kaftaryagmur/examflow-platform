#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-bitirme-pubsub}"
REGION="${REGION:-europe-west1}"
CLUSTER_NAME="${CLUSTER_NAME:-examflow-cluster}"
CLUSTER_LOCATION="${CLUSTER_LOCATION:-${REGION}}"
CLUSTER_LOCATION_FLAG="${CLUSTER_LOCATION_FLAG:---region}"
GKE_MODE="${GKE_MODE:-autopilot}"
NAMESPACE="${NAMESPACE:-examflow}"
VM_NAME="${VM_NAME:-jenkins-server}"
VM_ZONE="${VM_ZONE:-us-central1-a}"
K8S_OVERLAY="${K8S_OVERLAY:-k8s/overlays/prod}"
ENSURE_PUBSUB="${ENSURE_PUBSUB:-true}"
PUBSUB_TOPIC="${PUBSUB_TOPIC:-document-events}"
PUBSUB_SUBSCRIPTIONS="${PUBSUB_SUBSCRIPTIONS:-document-events-worker document-events-validation document-events-exam}"

echo "Using project: ${PROJECT_ID}"
gcloud config set project "${PROJECT_ID}"

if gcloud compute instances describe "${VM_NAME}" --zone="${VM_ZONE}" >/dev/null 2>&1; then
  VM_STATUS="$(gcloud compute instances describe "${VM_NAME}" --zone="${VM_ZONE}" --format='value(status)')"
  if [[ "${VM_STATUS}" != "RUNNING" ]]; then
    echo "Starting VM: ${VM_NAME} (${VM_ZONE})"
    gcloud compute instances start "${VM_NAME}" --zone="${VM_ZONE}"
  else
    echo "VM already running: ${VM_NAME}"
  fi
else
  echo "VM not found, skipping start: ${VM_NAME} (${VM_ZONE})"
fi

if [[ "${ENSURE_PUBSUB}" == "true" ]]; then
  if ! gcloud pubsub topics describe "${PUBSUB_TOPIC}" >/dev/null 2>&1; then
    echo "Creating Pub/Sub topic: ${PUBSUB_TOPIC}"
    gcloud pubsub topics create "${PUBSUB_TOPIC}"
  else
    echo "Pub/Sub topic already exists: ${PUBSUB_TOPIC}"
  fi

  for SUBSCRIPTION in ${PUBSUB_SUBSCRIPTIONS}; do
    if ! gcloud pubsub subscriptions describe "${SUBSCRIPTION}" >/dev/null 2>&1; then
      echo "Creating Pub/Sub subscription: ${SUBSCRIPTION} -> ${PUBSUB_TOPIC}"
      gcloud pubsub subscriptions create "${SUBSCRIPTION}" --topic="${PUBSUB_TOPIC}"
    else
      echo "Pub/Sub subscription already exists: ${SUBSCRIPTION}"
    fi
  done
fi

if ! gcloud container clusters describe "${CLUSTER_NAME}" "${CLUSTER_LOCATION_FLAG}"="${CLUSTER_LOCATION}" >/dev/null 2>&1; then
  echo "Creating GKE ${GKE_MODE} cluster: ${CLUSTER_NAME} (${CLUSTER_LOCATION})"
  if [[ "${GKE_MODE}" == "autopilot" ]]; then
    gcloud container clusters create-auto "${CLUSTER_NAME}" \
      "${CLUSTER_LOCATION_FLAG}"="${CLUSTER_LOCATION}"
  else
    gcloud container clusters create "${CLUSTER_NAME}" \
      "${CLUSTER_LOCATION_FLAG}"="${CLUSTER_LOCATION}" \
      --num-nodes=1 \
      --enable-autoscaling \
      --min-nodes=0 \
      --max-nodes=2
  fi
else
  echo "GKE cluster already exists: ${CLUSTER_NAME}"
fi

echo "Fetching cluster credentials"
gcloud container clusters get-credentials "${CLUSTER_NAME}" "${CLUSTER_LOCATION_FLAG}"="${CLUSTER_LOCATION}" --project="${PROJECT_ID}"

echo "Applying Kubernetes manifests: ${K8S_OVERLAY}"
kubectl apply -k "${K8S_OVERLAY}"

echo "Waiting for workloads in namespace: ${NAMESPACE}"
kubectl rollout status deployment/api-service -n "${NAMESPACE}" --timeout=180s
kubectl rollout status deployment/exam-service -n "${NAMESPACE}" --timeout=180s
kubectl rollout status deployment/validation-service -n "${NAMESPACE}" --timeout=180s
kubectl rollout status deployment/worker-service -n "${NAMESPACE}" --timeout=180s

echo "Development environment is ready."
