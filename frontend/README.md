# ExamFlow Frontend

Bu klasor ExamFlow icin React + Vite + Tailwind tabanli frontend uygulamasini barindirir.

## Kapsam

- `/demo/` altinda calisan public demo UI
- `/app/` altinda calisan authenticated frontend shell
- `/health` ve `/ready` durumlarini gosterme
- demo kullanici icin register/login akisi
- JWT ile protected `/publish` endpoint'ine multipart dosya gonderme
- `/documents` ve `/exams` kayitlarini listeleme
- document detayinda JWT korumali dosya endpoint'inden blob viewer/indirme akisi
- publish sonrasi received, processing, validated, published ve failed state takibi

## Lokal kullanim

API servisine port-forward ac:

```powershell
kubectl port-forward service/api-service 8080:80 -n examflow
```

Frontend uygulamasini calistir:

```powershell
cd frontend
npm install
npm run dev
```

Tarayicida ac:

```text
http://127.0.0.1:5173/demo/
http://127.0.0.1:5173/app/
```

Varsayilan API Base URL:

```text
/api
```

Vite dev proxy bu path'i `http://127.0.0.1:8080` adresine yonlendirir.

## Production container

```powershell
cd frontend
docker build -t examflow-frontend:local .
docker run --rm -p 5500:8080 examflow-frontend:local
```

Tarayicida:

```text
http://127.0.0.1:5500/demo/
http://127.0.0.1:5500/app/
```

Container icindeki nginx `/api/` isteklerini Kubernetes icindeki `api-service` servisine proxy'ler.

## Kubernetes

Manifestler:

```text
k8s/base/demo-ui-deployment.yaml
k8s/base/demo-ui-service.yaml
```

Deploy:

```powershell
kubectl apply -k k8s/overlays/prod
kubectl rollout status deployment/demo-ui -n examflow
kubectl get svc demo-ui -n examflow
```

`demo-ui` service tipi `LoadBalancer` oldugu icin external IP hazir oldugunda demo adresi:

```text
http://<DEMO_UI_EXTERNAL_IP>/demo/
http://<DEMO_UI_EXTERNAL_IP>/app/
```

Not: UI secilen `.pdf` veya `.docx` dosyasini `FormData` ile `file` alaninda gonderir. `documentId` ve `source` ayni multipart isteginde tasinir; `Content-Type` header'i browser tarafindan otomatik uretilir.

Document detail viewer, `fileUrl` degerini dogrudan iframe/href olarak kullanmaz. Frontend once stored JWT ile `/api/documents/{documentId}/file` endpoint'inden blob alir; onizleme, yeni sekme ve indirme aksiyonlari bu blob URL uzerinden calisir.
