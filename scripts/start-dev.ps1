$ErrorActionPreference = "Stop"
$Gcloud = "gcloud.cmd"

$ProjectId = if ($env:PROJECT_ID) { $env:PROJECT_ID } else { "bitirme-pubsub" }
$Region = if ($env:REGION) { $env:REGION } else { "europe-west1" }
$ClusterName = if ($env:CLUSTER_NAME) { $env:CLUSTER_NAME } else { "examflow-cluster" }
$ClusterLocation = if ($env:CLUSTER_LOCATION) { $env:CLUSTER_LOCATION } else { $Region }
$ClusterLocationFlag = if ($env:CLUSTER_LOCATION_FLAG) { $env:CLUSTER_LOCATION_FLAG } else { "--region" }
$GkeMode = if ($env:GKE_MODE) { $env:GKE_MODE } else { "autopilot" }
$Namespace = if ($env:NAMESPACE) { $env:NAMESPACE } else { "examflow" }
$VmName = if ($env:VM_NAME) { $env:VM_NAME } else { "jenkins-server" }
$VmZone = if ($env:VM_ZONE) { $env:VM_ZONE } else { "us-central1-a" }
$K8sOverlay = if ($env:K8S_OVERLAY) { $env:K8S_OVERLAY } else { "k8s/overlays/prod" }
$EnsurePubsub = if ($env:ENSURE_PUBSUB) { $env:ENSURE_PUBSUB } else { "true" }
$PubsubTopic = if ($env:PUBSUB_TOPIC) { $env:PUBSUB_TOPIC } else { "document-events" }
$PubsubSubscriptions = if ($env:PUBSUB_SUBSCRIPTIONS) {
    $env:PUBSUB_SUBSCRIPTIONS -split "\s+"
} else {
    @("document-events-worker", "document-events-validation", "document-events-exam")
}

Write-Host "Using project: $ProjectId"
& $Gcloud config set project $ProjectId

& $Gcloud compute instances describe $VmName --zone=$VmZone *> $null
if ($LASTEXITCODE -eq 0) {
    $VmStatus = & $Gcloud compute instances describe $VmName --zone=$VmZone --format="value(status)"
    if ($VmStatus -ne "RUNNING") {
        Write-Host "Starting VM: $VmName ($VmZone)"
        & $Gcloud compute instances start $VmName --zone=$VmZone
    } else {
        Write-Host "VM already running: $VmName"
    }
} else {
    Write-Host "VM not found, skipping start: $VmName ($VmZone)"
}

if ($EnsurePubsub -eq "true") {
    & $Gcloud pubsub topics describe $PubsubTopic *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Creating Pub/Sub topic: $PubsubTopic"
        & $Gcloud pubsub topics create $PubsubTopic
    } else {
        Write-Host "Pub/Sub topic already exists: $PubsubTopic"
    }

    foreach ($Subscription in $PubsubSubscriptions) {
        & $Gcloud pubsub subscriptions describe $Subscription *> $null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "Creating Pub/Sub subscription: $Subscription -> $PubsubTopic"
            & $Gcloud pubsub subscriptions create $Subscription --topic=$PubsubTopic
        } else {
            Write-Host "Pub/Sub subscription already exists: $Subscription"
        }
    }
}

& $Gcloud container clusters describe $ClusterName "$ClusterLocationFlag=$ClusterLocation" *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Creating GKE $GkeMode cluster: $ClusterName ($ClusterLocation)"
    if ($GkeMode -eq "autopilot") {
        & $Gcloud container clusters create-auto $ClusterName "$ClusterLocationFlag=$ClusterLocation"
    } else {
        & $Gcloud container clusters create $ClusterName "$ClusterLocationFlag=$ClusterLocation" --num-nodes=1 --enable-autoscaling --min-nodes=0 --max-nodes=2
    }
} else {
    Write-Host "GKE cluster already exists: $ClusterName"
}

Write-Host "Fetching cluster credentials"
& $Gcloud container clusters get-credentials $ClusterName "$ClusterLocationFlag=$ClusterLocation" --project=$ProjectId

Write-Host "Applying Kubernetes manifests: $K8sOverlay"
kubectl apply -k $K8sOverlay

Write-Host "Waiting for workloads in namespace: $Namespace"
kubectl rollout status deployment/api-service -n $Namespace --timeout=180s
kubectl rollout status deployment/exam-service -n $Namespace --timeout=180s
kubectl rollout status deployment/validation-service -n $Namespace --timeout=180s
kubectl rollout status deployment/worker-service -n $Namespace --timeout=180s

Write-Host "Development environment is ready."
