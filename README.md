# ExamFlow Platform

ExamFlow, GCP uzerinde calisan event-driven mikroservis ve Kubernetes deployment yasam dongusunu gostermek icin gelistirilen cloud-native bir bitirme projesidir.

Sistem; Go servisleri, Docker image'lari, Google Pub/Sub, Artifact Registry, GKE, Jenkins CI/CD ve Kustomize tabanli Kubernetes manifestlerinden olusur.

## Mimari Ozet

- `api-service`: Dis dunyadan gelen istekleri alir ve Pub/Sub event'i uretir.
- `worker-service`: `document-events-worker` subscription'i uzerinden event tuketir.
- `validation-service`: Validation event akisini dinler ve dogrulama sonucunu yayinlar.
- `exam-service`: Exam lifecycle tarafini temsil eder ve ilgili eventleri tuketir.
- `demo-ui`: Lokal demo icin hafif HTML/CSS/JavaScript arayuzu.

Cloud bilesenleri:

- Google Kubernetes Engine Autopilot
- Artifact Registry
- Google Pub/Sub
- Google Compute Engine uzerinde Jenkins

## Dizin Yapisi

```text
services/
  api-service/
  worker-service/
  validation-service/
  exam-service/
k8s/
  base/
  overlays/
    dev/
    prod/
demo-ui/
scripts/
docs/
Jenkinsfile
```

## Gereksinimler

Lokal gelistirme ve GCP ortam yonetimi icin:

- Go
- Docker
- Google Cloud CLI
- kubectl
- Git Bash veya PowerShell

GCP tarafinda:

- `bitirme-pubsub` project'i
- Artifact Registry repository: `examflow-images`
- Pub/Sub topic: `document-events`
- Pub/Sub subscriptions:
  - `document-events-worker`
  - `document-events-validation`
  - `document-events-exam`
- GKE cluster: `examflow-cluster`
- Jenkins VM: `jenkins-server`

`scripts/start-dev.*` eksik Pub/Sub topic/subscription kaynaklarini otomatik olusturur.

## Lokal Testler

Her servis kendi Go modulu olarak test edilebilir:

```powershell
cd services\api-service
go test ./...

cd ..\worker-service
go test ./...

cd ..\validation-service
go test ./...

cd ..\exam-service
go test ./...
```

## Development Ortamini Acma

Windows PowerShell:

```powershell
.\scripts\start-dev.ps1
```

Git Bash / Linux shell:

```bash
./scripts/start-dev.sh
```

Bu komutlar:

- Jenkins VM'i baslatir.
- Eksik Pub/Sub topic/subscription kaynaklarini olusturur.
- GKE cluster yoksa Autopilot cluster olusturur.
- Cluster credentials alir.
- `k8s/overlays/prod` manifestlerini uygular.
- Deployment rollout durumlarini bekler.

Varsayilan degerler:

```text
PROJECT_ID=bitirme-pubsub
REGION=europe-west1
CLUSTER_NAME=examflow-cluster
GKE_MODE=autopilot
VM_NAME=jenkins-server
VM_ZONE=us-central1-a
K8S_OVERLAY=k8s/overlays/prod
```

## Development Ortamini Kapatma

Windows PowerShell:

```powershell
.\scripts\stop-dev.ps1
```

Git Bash / Linux shell:

```bash
./scripts/stop-dev.sh
```

Varsayilan davranis:

- Jenkins VM stop edilir.
- GKE cluster delete edilir.

Bu islem repo'yu, Artifact Registry image'larini, Pub/Sub kaynaklarini veya Jenkins VM diskini silmez. Sadece calisan compute/GKE ortamini kapatir.

Sadece VM stop etmek icin:

```powershell
$env:DELETE_GKE="false"
.\scripts\stop-dev.ps1
```

Sadece GKE cluster silmek icin:

```powershell
$env:STOP_VM="false"
.\scripts\stop-dev.ps1
```

## Kubernetes Dogrulama Komutlari

Cluster ayaktayken:

```powershell
kubectl get pods -n examflow
kubectl get deploy -n examflow
kubectl get svc -n examflow
kubectl get hpa -n examflow
```

Loglari izlemek icin:

```powershell
kubectl logs -n examflow deployment/api-service --tail=100
kubectl logs -n examflow deployment/worker-service --tail=100
kubectl logs -n examflow deployment/validation-service --tail=100
kubectl logs -n examflow deployment/exam-service --tail=100
```

## Demo UI

API servisine lokal port-forward ac:

```powershell
kubectl port-forward service/api-service 8080:80 -n examflow
```

Ayrica bir terminalde demo UI'i baslat:

```powershell
cd demo-ui
python -m http.server 5500
```

Tarayicida ac:

```text
http://127.0.0.1:5500
```

Demo UI ile:

- `/health` kontrolu yapilabilir.
- `/ready` kontrolu yapilabilir.
- `/publish` istegi gonderilebilir.
- Backend response bilgisi gorulebilir.

## CI/CD Akisi

Jenkins multibranch pipeline kullanilir:

- `feature/*`, `fix/*`: build/test/deploy calismaz veya sinirli dogrulama yapilir.
- Pull Request: build, test ve image build dogrulamasi.
- `develop`: entegrasyon hatti.
- `main`: image push, GKE deploy, rollout status ve smoke test.

`main` pipeline asamalari:

```text
test -> docker build -> gcp auth -> artifact registry push -> kubernetes deploy -> rollout status -> smoke test
```

## Maliyet Notu

Gelistirme ortami ephemeral tasarlanmistir. Kullanilmadiginda GKE cluster silinir ve Jenkins VM durdurulur. Ayrintilar icin:

- [docs/cost-optimization.md](docs/cost-optimization.md)

## Secret Yonetimi

Gercek secret degerleri repo'ya commit edilmemelidir. Gelistirme icin Kubernetes Secret kullanilabilir; daha temiz production-like yaklasim icin Jenkins credentials veya Google Secret Manager tercih edilmelidir.

## Proje Konumlandirmasi

Bu proje, klasik tek parca bir web uygulamasindan ziyade, cloud-native mikroservis mimarisinin GCP, Kubernetes, Jenkins CI/CD, Artifact Registry ve Pub/Sub bilesenleriyle uctan uca nasil kurulabilecegini gosteren bir muhendislik calismasidir.
