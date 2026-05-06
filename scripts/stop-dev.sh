#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-bitirme-pubsub}"
REGION="${REGION:-europe-west1}"
CLUSTER_NAME="${CLUSTER_NAME:-examflow-cluster}"
CLUSTER_LOCATION="${CLUSTER_LOCATION:-${REGION}}"
CLUSTER_LOCATION_FLAG="${CLUSTER_LOCATION_FLAG:---region}"
VM_NAME="${VM_NAME:-jenkins-server}"
VM_ZONE="${VM_ZONE:-us-central1-a}"
DELETE_GKE="${DELETE_GKE:-true}"
STOP_VM="${STOP_VM:-true}"

echo "Using project: ${PROJECT_ID}"
gcloud config set project "${PROJECT_ID}"

if [[ "${STOP_VM}" == "true" ]]; then
  if gcloud compute instances describe "${VM_NAME}" --zone="${VM_ZONE}" >/dev/null 2>&1; then
    VM_STATUS="$(gcloud compute instances describe "${VM_NAME}" --zone="${VM_ZONE}" --format='value(status)')"
    if [[ "${VM_STATUS}" == "RUNNING" ]]; then
      echo "Stopping VM: ${VM_NAME} (${VM_ZONE})"
      gcloud compute instances stop "${VM_NAME}" --zone="${VM_ZONE}"
    else
      echo "VM is not running (${VM_STATUS}): ${VM_NAME}"
    fi
  else
    echo "VM not found, skipping stop: ${VM_NAME} (${VM_ZONE})"
  fi
fi

if [[ "${DELETE_GKE}" == "true" ]]; then
  if gcloud container clusters describe "${CLUSTER_NAME}" "${CLUSTER_LOCATION_FLAG}"="${CLUSTER_LOCATION}" >/dev/null 2>&1; then
    echo "Deleting GKE cluster: ${CLUSTER_NAME} (${CLUSTER_LOCATION})"
    gcloud container clusters delete "${CLUSTER_NAME}" "${CLUSTER_LOCATION_FLAG}"="${CLUSTER_LOCATION}" --quiet
  else
    echo "GKE cluster not found, skipping delete: ${CLUSTER_NAME}"
  fi
fi

echo "Development environment has been stopped."
