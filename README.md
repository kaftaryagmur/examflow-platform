# ExamFlow Platform

ExamFlow, GCP uzerinde calisan event-driven mikroservis ve Kubernetes deployment yasam dongusunu gostermek icin gelistirilen cloud-native bir bitirme projesidir.

Sistem; Go servisleri, Docker image'lari, Google Pub/Sub, MongoDB, Artifact Registry, GKE, Jenkins CI/CD ve Kustomize tabanli Kubernetes manifestlerinden olusur.

## Mimari Ozet

- `api-service`: Dis dunyadan gelen istekleri alir ve Pub/Sub event'i uretir.
- `worker-service`: `document-events-worker` subscription'i uzerinden `document.uploaded` eventlerini tuketir ve `document.processed` event'i yayinlar.
- `validation-service`: Validation event akisini dinler ve dogrulama sonucunu yayinlar.
- `exam-service`: Exam lifecycle tarafini temsil eder, ilgili eventleri tuketir ve validated examlar icin Anthropic Claude API ile soru/bilgi karti uretir.
- `mongodb`: Kullanici, document, exam ve islem gecmisi verileri icin kalici veri katmani olarak konumlandirilir.
- `frontend`: Public demo ve authenticated app ekranlarini iceren React/Vite frontend uygulamasi.

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
frontend/
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

SCRUM-89 kapsaminda `/publish`, JSON body yerine `multipart/form-data` kabul eder. Istek `file` alaninda gercek `.pdf` veya `.docx` dosyasini, `source` alaninda kaynak bilgisini ve opsiyonel `documentId` alanini birlikte tasir. API service dosya icerigini okur, uzanti/size/content-type kontrolu yapar ve MongoDB `documents` kaydina dosya metadata bilgisini yazar.

SCRUM-88 kapsaminda API service, yuklenen PDF/DOCX binary icerigini MongoDB GridFS icinde saklar. `documents` kaydi GridFS referansi icin `fileId`, storage tipi icin `storageBackend` ve frontend viewer icin JWT korumali `fileUrl` alanlarini tasir. Dosya icerigi `GET /documents/{documentId}/file` endpoint'i ile sadece ilgili kullaniciya sunulur.

SCRUM-40 kapsaminda API service, MongoDB uzerinden kullaniciya ait kalici `documents` ve `exams` kayitlarini okuyabilen protected endpointler sunar. Bu sayede document create/read ve exam create/read akislarinin veritabani uzerinden dogrulanmasi mumkun hale gelir.

SCRUM-90 kapsaminda exam-service, `validated` durumuna gecen examlar icin Anthropic Claude API'sini (Messages API, tool use ile yapilandirilmis JSON) cagirir ve uretilen `questions` ile `infoCards` alanlarini `exams` kaydina yazar. API anahtari `ANTHROPIC_API_KEY` olarak Kubernetes Secret uzerinden inject edilir; model `ANTHROPIC_MODEL` (varsayilan `claude-opus-4-8`) ile yapilandirilir. Anahtar yoksa veya uretim hata verirse exam soru alanlari bos sekilde yine kaydedilir, event zinciri bloke olmaz. `GET /exams` bu alanlari frontend exam detay ekranina dondurur.

SCRUM-91 kapsaminda uretim, dokumanin gercek icerigine dayandirilir: exam-service `documents.fileId` uzerinden GridFS'ten dosya binary'sini indirir, PDF'i Claude'a native document content block (base64) olarak gonderir, DOCX'i standart kutuphane ile metne cevirir; icerik alinamazsa dosya adi metadata fallback'i kullanilir. Anthropic cagrisi gecici hatalarda (429/5xx, ag) ve hatali/eksik AI ciktilarinda kisa backoff ile yeniden denenir (en fazla 3 deneme; 400/401/403 gibi kalici hatalarda denenmez). Donen JSON, sema disinda ayrica dogrulanir (tam 4 secenek, A-D cevap, gecerli difficulty); gecersiz sorular elenir, hicbir gecerli soru kalmazsa cikti hatali sayilip retry/fallback devreye girer.

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

## Document Upload Endpoint

`/publish` protected endpoint'tir ve `multipart/form-data` bekler.

Zorunlu alan:

- `file`: `.pdf` veya `.docx`

Opsiyonel alanlar:

- `documentId`: verilmezse API service tarafinda uretilir
- `source`: verilmezse `manual` kullanilir

Ornek:

```powershell
$Token = "<login-response-token>"
curl.exe -X POST http://127.0.0.1:8080/publish `
  -H "Authorization: Bearer $Token" `
  -F "documentId=doc-42" `
  -F "source=web" `
  -F "file=@C:\path\week1.pdf;type=application/pdf"
```

## Persistence Endpointleri

Protected endpoint'ler JWT icindeki `userId` alanini kullanarak sadece ilgili kullaniciya ait kayitlari dondurur.

Kullaniciya ait document kayitlarini listele:

```powershell
curl.exe http://127.0.0.1:8080/documents `
  -H "Authorization: Bearer $Token"
```

Kullaniciya ait document dosyasini inline/binary olarak al:

```powershell
curl.exe http://127.0.0.1:8080/documents/doc-42/file `
  -H "Authorization: Bearer $Token" `
  -o week1.pdf
```

Kullaniciya ait exam kayitlarini listele:

```powershell
curl.exe http://127.0.0.1:8080/exams `
  -H "Authorization: Bearer $Token"
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

## Frontend

API servisine lokal port-forward ac:

```powershell
kubectl port-forward service/api-service 8080:80 -n examflow
```

Ayrica bir terminalde React/Vite frontend uygulamasini baslat:

```powershell
cd frontend
npm install
npm run dev
```

Tarayicida ac:

```text
http://127.0.0.1:5173/demo/
```

Frontend ile:

- `/health` kontrolu yapilabilir.
- `/ready` kontrolu yapilabilir.
- demo kullanici icin register/login akisi olusturulabilir.
- `/publish` ile gercek `.pdf` veya `.docx` dosyasi multipart olarak gonderilebilir.
- `/documents` ve `/exams` kayitlari gorulebilir.
- document detayinda `fileUrl` uzerinden JWT korumali dosya viewer/indirme akisi kullanilabilir.
- received, processing, validated, published ve failed state'leri takip edilebilir.

Not: `/publish` protected endpoint oldugu icin once register/login akisi ile JWT alinmali ve istek `Authorization: Bearer <token>` header'i ile gonderilmelidir. Frontend, `Content-Type` header'ini elle set etmez; browser `FormData` icin multipart boundary bilgisini otomatik uretir.

Frontend container image'i:

```powershell
cd frontend
docker build -t examflow-frontend:local .
docker run --rm -p 5500:8080 examflow-frontend:local
```

Container demo adresi:

```text
http://127.0.0.1:5500/demo/
```

Kubernetes uzerinde frontend uygulamasi su an `demo-ui` Deployment ve LoadBalancer Service manifestleri ile expose edilir. Public endpoint icin:

```powershell
kubectl apply -k k8s/overlays/prod
kubectl rollout status deployment/demo-ui -n examflow
kubectl get svc demo-ui -n examflow
```

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

### Anthropic API Key (Google Secret Manager)

Exam-service'in kullandigi `ANTHROPIC_API_KEY` repoya commit edilmez. `k8s/base/app-secret.yaml` icinde bu alan bos birakilir ve gercek deger deploy sirasinda Google Secret Manager'dan cekilerek `examflow-secret`'a enjekte edilir.

Bir kerelik kurulum (gercek anahtar ile, yeni bir key uretildikten sonra):

```powershell
# Secret'i olustur ve ilk surumu ekle
gcloud secrets create anthropic-api-key --project=project-ae272ac8-a64f-4afa-8b7 --replication-policy=automatic
"sk-ant-..." | gcloud secrets versions add anthropic-api-key --project=project-ae272ac8-a64f-4afa-8b7 --data-file=-

# Deploy eden kimlige (Jenkins service account veya gelistirici) okuma izni ver
gcloud secrets add-iam-policy-binding anthropic-api-key `
  --project=project-ae272ac8-a64f-4afa-8b7 `
  --member="serviceAccount:JENKINS_OR_DEPLOY_SA@project-ae272ac8-a64f-4afa-8b7.iam.gserviceaccount.com" `
  --role="roles/secretmanager.secretAccessor"
```

Deploy akisi (`Jenkinsfile` deploy stage'i ve `scripts/start-dev.*`) `kubectl apply -k` sonrasinda anahtari `gcloud secrets versions access latest --secret=anthropic-api-key` ile cekip `examflow-secret`'a patch'ler ve exam-service'i yeniden baslatir. Secret erisilemezse exam-service AI uretimi devre disi sekilde calismaya devam eder (event zinciri bloke olmaz). Secret adi `ANTHROPIC_SECRET_NAME` ile, model `ANTHROPIC_MODEL` ile degistirilebilir.

## Proje Konumlandirmasi

Bu proje, klasik tek parca bir web uygulamasindan ziyade, cloud-native mikroservis mimarisinin GCP, Kubernetes, Jenkins CI/CD, Artifact Registry ve Pub/Sub bilesenleriyle uctan uca nasil kurulabilecegini gosteren bir muhendislik calismasidir.
