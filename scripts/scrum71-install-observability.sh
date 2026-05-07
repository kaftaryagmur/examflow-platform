#!/usr/bin/env bash
set -euo pipefail

NAMESPACE="${NAMESPACE:-observability}"
RELEASE_NAME="${RELEASE_NAME:-monitoring}"
CHART_VERSION="${CHART_VERSION:-84.5.0}"
GRAFANA_PASSWORD="${GRAFANA_PASSWORD:-ExamflowGrafana123!}"

echo "Creating namespace: $NAMESPACE"
kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

echo "Adding Prometheus community Helm repo..."
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

echo "Installing kube-prometheus-stack..."
helm upgrade --install "$RELEASE_NAME" prometheus-community/kube-prometheus-stack \
  --namespace "$NAMESPACE" \
  --version "$CHART_VERSION" \
  -f k8s/observability/values-gke.yaml \
  --set grafana.adminPassword="$GRAFANA_PASSWORD"

echo "Waiting for observability pods..."
kubectl get pods -n "$NAMESPACE"

echo
echo "Grafana access:"
echo "kubectl port-forward svc/${RELEASE_NAME}-grafana -n $NAMESPACE 3000:80"

echo
echo "Prometheus access:"
echo "kubectl port-forward svc/${RELEASE_NAME}-kube-prometheus-prometheus -n $NAMESPACE 9090:9090"