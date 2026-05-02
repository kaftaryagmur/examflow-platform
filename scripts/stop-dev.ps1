$ErrorActionPreference = "Stop"
$Gcloud = "gcloud.cmd"

$ProjectId = if ($env:PROJECT_ID) { $env:PROJECT_ID } else { "bitirme-pubsub" }
$Region = if ($env:REGION) { $env:REGION } else { "europe-west1" }
$ClusterName = if ($env:CLUSTER_NAME) { $env:CLUSTER_NAME } else { "examflow-cluster" }
$ClusterLocation = if ($env:CLUSTER_LOCATION) { $env:CLUSTER_LOCATION } else { $Region }
$ClusterLocationFlag = if ($env:CLUSTER_LOCATION_FLAG) { $env:CLUSTER_LOCATION_FLAG } else { "--region" }
$VmName = if ($env:VM_NAME) { $env:VM_NAME } else { "jenkins-server" }
$VmZone = if ($env:VM_ZONE) { $env:VM_ZONE } else { "us-central1-a" }
$DeleteGke = if ($env:DELETE_GKE) { $env:DELETE_GKE } else { "true" }
$StopVm = if ($env:STOP_VM) { $env:STOP_VM } else { "true" }

Write-Host "Using project: $ProjectId"
& $Gcloud config set project $ProjectId

if ($StopVm -eq "true") {
    & $Gcloud compute instances describe $VmName --zone=$VmZone *> $null
    if ($LASTEXITCODE -eq 0) {
        $VmStatus = & $Gcloud compute instances describe $VmName --zone=$VmZone --format="value(status)"
        if ($VmStatus -eq "RUNNING") {
            Write-Host "Stopping VM: $VmName ($VmZone)"
            & $Gcloud compute instances stop $VmName --zone=$VmZone
        } else {
            Write-Host "VM is not running ($VmStatus): $VmName"
        }
    } else {
        Write-Host "VM not found, skipping stop: $VmName ($VmZone)"
    }
}

if ($DeleteGke -eq "true") {
    & $Gcloud container clusters describe $ClusterName "$ClusterLocationFlag=$ClusterLocation" *> $null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Deleting GKE cluster: $ClusterName ($ClusterLocation)"
        & $Gcloud container clusters delete $ClusterName "$ClusterLocationFlag=$ClusterLocation" --quiet
    } else {
        Write-Host "GKE cluster not found, skipping delete: $ClusterName"
    }
}

Write-Host "Development environment has been stopped."
