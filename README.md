# ExamFlow Platform

ExamFlow, GCP uzerinde calisan event-driven mikroservis ve Kubernetes deployment yasam dongusunu gostermek icin gelistirilen cloud-native bir bitirme projesidir.

Sistem; Go servisleri, Docker image'lari, Google Pub/Sub, MongoDB, Artifact Registry, GKE, Jenkins CI/CD ve Kustomize tabanli Kubernetes manifestlerinden olusur.

## Mimari Ozet

- `api-service`: Dis dunyadan gelen istekleri alir ve Pub/Sub event'i uretir.
- `worker-service`: `document-events-worker` subscription'i uzerinden `document.uploaded` eventlerini tuketir ve `document.processed` event'i yayinlar.
- `validation-service`: Validation event akisini dinler ve dogrulama sonucunu yayinlar.
- `exam-service`: Exam lifecycle tarafini temsil eder ve ilgili eventleri tuketir.
- `mongodb`: Kullanici, document, exam ve islem gecmisi verileri icin kalici veri katmani olarak konumlandirilir.
- `demo-ui`: Lokal demo icin hafif HTML/CSS/JavaScript arayuzu.

Temel uygulama akisi:

```text
User JWT -> API -> Pub/Sub event -> Worker -> Validation -> Exam Service -> MongoDB
```

Cloud bilesenleri:

- Google Kubernetes Engine Autopilot
- Artifact Registry
- Google Pub/Sub
- MongoDB persistent volume ile Kubernetes icinde calisan veri katmani
- Google Compute Engine uzerinde Jenkins

Domain veri modeli ayrintilari icin:

- [docs/data-models.md](docs/data-models.md)

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
- MongoDB service: `mongodb`
- MongoDB PVC: `mongodb-data`
- GKE cluster: `examflow-cluster`
- Jenkins VM: `jenkins-server`

`scripts/start-dev.*` eksik Pub/Sub topic/subscription kaynaklarini otomatik olusturur.

## MongoDB Veri Katmani

MongoDB, Kubernetes icinde ayri `Deployment`, `Service` ve `PersistentVolumeClaim` olarak calisir.

Kaynaklar:

```text
deployment/mongodb
service/mongodb
persistentvolumeclaim/mongodb-data
```

Baglanti bilgileri manifestlere hardcoded yazilmaz:

- `MONGODB_HOST`, `MONGODB_PORT`, `MONGODB_DATABASE`: `examflow-config` ConfigMap
- `MONGODB_USERNAME`, `MONGODB_PASSWORD`: `examflow-secret` Secret
- `MONGODB_URI`: servis container'larina environment variable olarak inject edilir

Cluster ici baglanti Kubernetes service discovery ile yapilir:

```text
mongodb://$(MONGODB_USERNAME):$(MONGODB_PASSWORD)@$(MONGODB_HOST):$(MONGODB_PORT)/$(MONGODB_DATABASE)?authSource=admin
```

Varsayilan service adi:

```text
mongodb
```

API service acilis sirasinda MongoDB baglantisini kontrol eder, `connection_checks` collection'i uzerinden insert/read dogrulamasi yapar ve sonucu loglar. `/ready` endpoint'i MongoDB ping sonucunu `databaseStatus` alani ile raporlar.

Exam service, `exam.validation.completed` eventlerinden olusan exam state kayitlarini `exams` collection'ina yazar. MongoDB verisi `mongodb-data` PVC uzerinde tutuldugu icin pod restart durumunda veri korunur.

SCRUM-27 kapsaminda temel collection modeli su sekilde konumlandirilir:

```text
users      -> kullanici hesabi ve auth sonrasi profil bilgileri
documents  -> kullaniciya ait dokuman kayitlari ve islenme durumu
exams      -> document/validation akisi sonucunda olusan exam state kayitlari
```

Detayli alan listesi ve iliski notlari [docs/data-models.md](docs/data-models.md) icinde tutulur.

SCRUM-32 kapsaminda `/publish` endpoint'i protected hale getirilir. JWT icindeki `userId`, `document.uploaded` event'ine eklenir ve worker/validation zinciri boyunca korunarak exam-service tarafinda `exams.userId` alanina yazilir.

SCRUM-34 kapsaminda `/publish`, event yayinlamadan once MongoDB `documents` collection'inda `uploaded` durumunda kullaniciya ait bir dokuman kaydi olusturur. Bu sayede dokuman archive ekranlari icin kalici veri zemini hazirlanir.

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

## Auth Endpointleri

SCRUM-26 kapsaminda register/login altyapisi API service icinde baslatilmistir. Kullanici kayitlari `users` collection'ina yazilir ve parola duz metin olarak saklanmaz.
SCRUM-31 kapsaminda login yaniti JWT tabanli hale getirilmis ve protected endpoint icin auth middleware eklenmistir. JWT imza anahtari `JWT_SECRET` olarak Kubernetes Secret uzerinden inject edilir.

Register:

```powershell
curl.exe -X POST http://127.0.0.1:8080/auth/register `
  -H "Content-Type: application/json" `
  -d "{\"email\":\"teacher@example.com\",\"displayName\":\"Teacher User\",\"password\":\"strongpass\"}"
```

Login:

```powershell
curl.exe -X POST http://127.0.0.1:8080/auth/login `
  -H "Content-Type: application/json" `
  -d "{\"email\":\"teacher@example.com\",\"password\":\"strongpass\"}"
```

Login basarili oldugunda JWT token doner. Protected endpoint'lere erisim icin standart Bearer token header'i kullanilir:

```powershell
$Token = "<login-response-token>"
curl.exe http://127.0.0.1:8080/auth/me `
  -H "Authorization: Bearer $Token"
```

Eksik, hatali veya expire olmus token durumunda API `401 Unauthorized` doner.

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
START_JENKINS_CONTAINER=true
JENKINS_CONTAINER_NAME=jenkins
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

## Operational Modes

Iki farkli calisma modu kullanilir.

### CI Mode

PR, `develop` pipeline veya sadece build/test dogrulamasi icin kullanilir. Bu modda GKE cluster acmak gerekmez; Jenkins VM'in calismasi yeterlidir.

Start:

```powershell
gcloud compute instances start jenkins-server --zone=us-central1-a
gcloud compute ssh jenkins-server --zone=us-central1-a --command="docker start jenkins"
```

Stop:

```powershell
gcloud compute instances stop jenkins-server --zone=us-central1-a
```

Kullanim:

```text
PR kontrolu
develop pipeline
test/build dogrulamasi
```

### Full Dev/Deploy Mode

GKE deploy, rollout, smoke test veya canli demo gerektiginde kullanilir.

Start:

```powershell
.\scripts\start-dev.ps1
```

Stop:

```powershell
.\scripts\stop-dev.ps1
```

Kullanim:

```text
main deploy
GKE uzerinde canli test
kubectl rollout/smoke test
sunum veya demo hazirligi
```

## Jenkins IP Degistiginde Webhook Guncelleme

Jenkins VM stop/start yapildiginda external IP degisebilir. Bu durumda Jenkins URL ve GitHub webhook URL guncellenmelidir.

Yeni external IP'yi ogrenmek icin:

```powershell
gcloud compute instances describe jenkins-server `
  --zone=us-central1-a `
  --format="value(networkInterfaces[0].accessConfigs[0].natIP)"
```

Ornek yeni IP:

```text
136.116.180.42
```

### Jenkins URL Guncelleme

Jenkins arayuzunde:

```text
Manage Jenkins -> System -> Jenkins URL
```

alanini guncelle:

```text
http://NEW_EXTERNAL_IP:8080/
```

Ornek:

```text
http://136.116.180.42:8080/
```

Kaydet.

### GitHub Webhook Guncelleme

GitHub repository icinde:

```text
Settings -> Webhooks
```

mevcut webhook'u duzenle.

Payload URL alanini guncelle:

```text
http://NEW_EXTERNAL_IP:8080/github-webhook/
```

Ornek:

```text
http://136.116.180.42:8080/github-webhook/
```

Content type:

```text
application/json
```

Events:

```text
Pull requests
Pushes
```

Kaydettikten sonra gerekirse webhook delivery tekrar gonderilebilir veya Jenkins uzerinde multibranch pipeline icin manuel scan calistirilabilir:

```text
Scan Multibranch Pipeline Now
```

Not: Jenkins VM icin static external IP kullanilmadigi surece VM her stop/start sonrasinda IP degisebilir. Bu nedenle PR pipeline otomatik tetiklenmezse once Jenkins URL ve GitHub webhook URL kontrol edilmelidir.

## Kubernetes Dogrulama Komutlari

Cluster ayaktayken:

```powershell
kubectl get pods -n examflow
kubectl get deploy -n examflow
kubectl get svc -n examflow
kubectl get pvc -n examflow
kubectl get hpa -n examflow
```

Loglari izlemek icin:

```powershell
kubectl logs -n examflow deployment/api-service --tail=100
kubectl logs -n examflow deployment/worker-service --tail=100
kubectl logs -n examflow deployment/validation-service --tail=100
kubectl logs -n examflow deployment/exam-service --tail=100
kubectl logs -n examflow deployment/mongodb --tail=100
```

MongoDB insert/read smoke test:

```powershell
$Namespace = "examflow"
$MongoUserEncoded = kubectl get secret examflow-secret -n $Namespace -o jsonpath="{.data.MONGODB_USERNAME}"
$MongoPasswordEncoded = kubectl get secret examflow-secret -n $Namespace -o jsonpath="{.data.MONGODB_PASSWORD}"
$MongoUser = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($MongoUserEncoded))
$MongoPassword = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($MongoPasswordEncoded))
$MongoDatabase = kubectl get configmap examflow-config -n $Namespace -o jsonpath="{.data.MONGODB_DATABASE}"
$MongoSmokeScript = "const smokeDb = db.getSiblingDB('$MongoDatabase'); const result = smokeDb.connection_checks.insertOne({ service: 'manual-smoke', checkedAt: new Date() }); const found = smokeDb.connection_checks.findOne({ _id: result.insertedId }); if (!found) { throw new Error('mongodb smoke read failed'); } print('mongodb smoke ok');"
kubectl exec -n $Namespace deployment/mongodb -- mongosh -u $MongoUser -p $MongoPassword --authenticationDatabase admin --quiet --eval $MongoSmokeScript
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

Not: `/publish` protected endpoint oldugu icin once register/login akisi ile JWT alinmali ve istek `Authorization: Bearer <token>` header'i ile gonderilmelidir.

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
